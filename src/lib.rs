//! # medroute
//!
//! Optimal solar-power allocation for medicine delivery networks.
//!
//! The network is a connected, directed, tripartite acyclic graph:
//! `source -> pass-through -> destination`. Every pass-through and destination
//! has a daily opening window `[a, b]` (whole hours, `0 <= a < b < 24`);
//! sources are always available. Given a budget of `n` nodes, the solver picks
//! the pass-throughs/destinations whose window should be replaced by `[0, 23]`
//! (because they get solar power) so that the weighted time-to-delivery of the
//! whole network is minimised.
//!
//! ## Model, in the order the code is organised
//!
//! 1. **Data types** – validated newtypes ([`Latitude`], [`Longitude`],
//!    [`Coordinate`], [`TimeWindow`], [`Priority`], [`NodeIndex`]) and the
//!    [`Node`] enum, whose variants make illegal states (a source with an
//!    opening window, a pass-through with a priority, ...) unrepresentable.
//! 2. **Graph** – [`Graph::new`] validates the structure and pre-computes, for
//!    every destination, a [`Route`] made of [`Leg`]s (one per pass-through).
//! 3. **Evaluation** – [`destination_time_to_delivery`],
//!    [`average_time_to_delivery`], [`weighted_time_to_delivery`].
//! 4. **Search** – [`exact_search`], [`greedy_search`], [`solve`].
//! 5. **I/O** – [`parse_graph_file`], [`analyze_bytes`], [`ServerSettings`].
//!
//! ## Interpretation of the specification
//!
//! * A delivery goes `source -> pass-through -> destination` along existing
//!   edges. Time = transit(source, pass-through) + wait for the pass-through to
//!   open + transit(pass-through, destination) + wait for the destination to
//!   open.
//! * Transit time is great-circle (haversine) distance at 60 km/h.
//! * Windows are closed intervals on a repeating 24 h clock. `[0, 23]` is taken
//!   literally: the node is open from 00:00 to 23:00 inclusive (so arriving at
//!   23:30 means waiting 30 min until midnight).
//! * "At a given time" is the departure time from the source. Several
//!   departure times may be supplied; the network objective averages over them
//!   (default: each whole hour `0..=23`).
//! * Only pass-throughs and destinations can be chosen (sources have no
//!   window to replace).

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Speed of every transit leg.
pub const TRANSIT_SPEED_KPH: f64 = 60.0;
/// Mean Earth radius used by the haversine formula.
pub const EARTH_RADIUS_KM: f64 = 6371.0088;
/// Length of the repeating opening-hours clock.
pub const HOURS_PER_DAY: f64 = 24.0;

/// Tolerance when deciding whether a clock reading lies on a window boundary.
const CLOCK_EPSILON: f64 = 1e-9;
/// An objective must improve by more than this to replace the incumbent.
/// (Makes tie-breaking deterministic: earliest candidate wins.)
const IMPROVEMENT_TOLERANCE: f64 = 1e-12;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Everything that can be wrong with the *model* (values or graph structure).
#[derive(Debug, Clone, PartialEq, Error)]
pub enum ModelError {
    #[error("latitude {0} must be a finite value in [-90, 90]")]
    InvalidLatitude(f64),
    #[error("longitude {0} must be a finite value in [-180, 180]")]
    InvalidLongitude(f64),
    #[error("opening window [{start}, {end}] is invalid: need 0 <= start < end < 24")]
    InvalidWindow { start: i64, end: i64 },
    #[error("priority {0} must be finite and non-negative")]
    InvalidPriority(f64),
    #[error("departure hour {0} must be finite and in [0, 24)")]
    InvalidDepartureHour(f64),
    #[error("at least one departure hour is required")]
    NoDepartureHours,
    #[error("the graph has no nodes")]
    EmptyGraph,
    #[error("duplicate node id `{0}`")]
    DuplicateId(String),
    #[error("node index {0} is out of range")]
    IndexOutOfRange(usize),
    #[error("edge `{from}` -> `{to}` is invalid: edges must run source -> pass-through or pass-through -> destination")]
    InvalidEdge { from: String, to: String },
    #[error("edge `{from}` -> `{to}` appears more than once")]
    DuplicateEdge { from: String, to: String },
    #[error("node `{id}` {problem}")]
    DanglingNode { id: String, problem: &'static str },
    #[error("the graph is not connected")]
    Disconnected,
    #[error("the total priority of all destinations must be greater than zero")]
    ZeroTotalPriority,
}

/// Errors while turning an uploaded file into a validated graph.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum InputError {
    #[error("malformed graph file: {0}")]
    Json(String),
    #[error("edge refers to unknown node id `{0}`")]
    UnknownNodeId(String),
    #[error(transparent)]
    Model(#[from] ModelError),
}

/// Errors while searching for the best set of nodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum SolveError {
    #[error("n must be at least 1")]
    ZeroSelection,
    #[error("n = {requested} but only {available} nodes (pass-throughs and destinations) can be upgraded")]
    TooManyNodes { requested: usize, available: usize },
    #[error("exact search would need more than {limit} combinations; use strategy `greedy` or `auto`, or raise the limit")]
    ExactTooLarge { limit: u64 },
}

/// Any failure of [`analyze_bytes`].
#[derive(Debug, Clone, PartialEq, Error)]
pub enum AnalyzeError {
    #[error(transparent)]
    Input(#[from] InputError),
    #[error(transparent)]
    Solve(#[from] SolveError),
}

// ---------------------------------------------------------------------------
// Validated primitive types
// ---------------------------------------------------------------------------

/// Latitude in degrees, `[-90, 90]`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Latitude(f64);

impl Latitude {
    pub fn new(degrees: f64) -> Result<Self, ModelError> {
        if degrees.is_finite() && (-90.0..=90.0).contains(&degrees) {
            Ok(Self(degrees))
        } else {
            Err(ModelError::InvalidLatitude(degrees))
        }
    }

    pub fn degrees(self) -> f64 {
        self.0
    }
}

/// Longitude in degrees, `[-180, 180]`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Longitude(f64);

impl Longitude {
    pub fn new(degrees: f64) -> Result<Self, ModelError> {
        if degrees.is_finite() && (-180.0..=180.0).contains(&degrees) {
            Ok(Self(degrees))
        } else {
            Err(ModelError::InvalidLongitude(degrees))
        }
    }

    pub fn degrees(self) -> f64 {
        self.0
    }
}

/// A point on Earth.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coordinate {
    latitude: Latitude,
    longitude: Longitude,
}

impl Coordinate {
    pub fn new(latitude: f64, longitude: f64) -> Result<Self, ModelError> {
        Ok(Self {
            latitude: Latitude::new(latitude)?,
            longitude: Longitude::new(longitude)?,
        })
    }

    pub fn latitude(self) -> Latitude {
        self.latitude
    }

    pub fn longitude(self) -> Longitude {
        self.longitude
    }

    /// Great-circle (haversine) distance in kilometres.
    pub fn distance_km(self, other: Coordinate) -> f64 {
        let phi1 = self.latitude.degrees().to_radians();
        let phi2 = other.latitude.degrees().to_radians();
        let d_phi = phi2 - phi1;
        let d_lambda = (other.longitude.degrees() - self.longitude.degrees()).to_radians();
        let a = (d_phi / 2.0).sin().powi(2)
            + phi1.cos() * phi2.cos() * (d_lambda / 2.0).sin().powi(2);
        2.0 * EARTH_RADIUS_KM * a.sqrt().min(1.0).asin()
    }

    /// Transit time in hours at [`TRANSIT_SPEED_KPH`].
    pub fn travel_hours(self, other: Coordinate) -> f64 {
        self.distance_km(other) / TRANSIT_SPEED_KPH
    }
}

/// Daily opening interval `[start, end]` in whole hours, `0 <= start < end < 24`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeWindow {
    start: u8,
    end: u8,
}

impl TimeWindow {
    /// What a node with solar power gets: open from 00:00 to 23:00.
    pub const ALWAYS_OPEN: TimeWindow = TimeWindow { start: 0, end: 23 };

    pub fn new(start: i64, end: i64) -> Result<Self, ModelError> {
        if (0..24).contains(&start) && (0..24).contains(&end) && start < end {
            // Both values are in 0..24, so the narrowing casts are lossless.
            Ok(Self {
                start: start as u8,
                end: end as u8,
            })
        } else {
            Err(ModelError::InvalidWindow { start, end })
        }
    }

    pub fn start(self) -> u8 {
        self.start
    }

    pub fn end(self) -> u8 {
        self.end
    }

    /// Hours to wait, when arriving at absolute time `clock` (hours, may exceed
    /// 24 or be negative), until the window is next open. Zero if already open.
    pub fn wait_hours(self, clock: f64) -> f64 {
        let time_of_day = clock.rem_euclid(HOURS_PER_DAY);
        let start = f64::from(self.start);
        let end = f64::from(self.end);
        if time_of_day >= start - CLOCK_EPSILON && time_of_day <= end + CLOCK_EPSILON {
            0.0
        } else if time_of_day < start {
            start - time_of_day
        } else {
            HOURS_PER_DAY - time_of_day + start
        }
    }
}

/// Non-negative, finite destination weight.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Priority(f64);

impl Priority {
    pub fn new(value: f64) -> Result<Self, ModelError> {
        if value.is_finite() && value >= 0.0 {
            Ok(Self(value))
        } else {
            Err(ModelError::InvalidPriority(value))
        }
    }

    pub fn value(self) -> f64 {
        self.0
    }
}

/// Position of a node inside a [`Graph`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeIndex(usize);

impl NodeIndex {
    pub fn new(index: usize) -> Self {
        Self(index)
    }

    pub fn get(self) -> usize {
        self.0
    }
}

/// Departure times (hours in `[0, 24)`) over which the objective is averaged.
#[derive(Debug, Clone, PartialEq)]
pub struct DepartureTimes(Vec<f64>);

impl DepartureTimes {
    pub fn new(hours: Vec<f64>) -> Result<Self, ModelError> {
        if hours.is_empty() {
            return Err(ModelError::NoDepartureHours);
        }
        if let Some(bad) = hours
            .iter()
            .copied()
            .find(|h| !(h.is_finite() && (0.0..HOURS_PER_DAY).contains(h)))
        {
            return Err(ModelError::InvalidDepartureHour(bad));
        }
        Ok(Self(hours))
    }

    /// `0, 1, ..., 23`.
    pub fn every_hour() -> Self {
        Self((0..24).map(f64::from).collect())
    }

    pub fn as_slice(&self) -> &[f64] {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/// Which part of the tripartite graph a node belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Source,
    PassThrough,
    Destination,
}

impl fmt::Display for NodeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            NodeKind::Source => "source",
            NodeKind::PassThrough => "pass-through",
            NodeKind::Destination => "destination",
        })
    }
}

/// A graph node. Each variant carries exactly the data its role requires:
/// `(c, None, None)`, `(c, Some(t), None)` or `(c, Some(t), Some(p))`.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    Source {
        id: String,
        location: Coordinate,
    },
    PassThrough {
        id: String,
        location: Coordinate,
        window: TimeWindow,
    },
    Destination {
        id: String,
        location: Coordinate,
        window: TimeWindow,
        priority: Priority,
    },
}

impl Node {
    pub fn id(&self) -> &str {
        match self {
            Node::Source { id, .. } | Node::PassThrough { id, .. } | Node::Destination { id, .. } => id,
        }
    }

    pub fn location(&self) -> Coordinate {
        match self {
            Node::Source { location, .. }
            | Node::PassThrough { location, .. }
            | Node::Destination { location, .. } => *location,
        }
    }

    pub fn kind(&self) -> NodeKind {
        match self {
            Node::Source { .. } => NodeKind::Source,
            Node::PassThrough { .. } => NodeKind::PassThrough,
            Node::Destination { .. } => NodeKind::Destination,
        }
    }

    /// `None` for sources.
    pub fn window(&self) -> Option<TimeWindow> {
        match self {
            Node::Source { .. } => None,
            Node::PassThrough { window, .. } | Node::Destination { window, .. } => Some(*window),
        }
    }

    /// `Some` only for destinations.
    pub fn priority(&self) -> Option<Priority> {
        match self {
            Node::Destination { priority, .. } => Some(*priority),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

/// One way of reaching a destination: through a specific pass-through.
///
/// `inbound_hours` is the transit time of the *fastest* source feeding the
/// pass-through. This is exact: sources never wait, and the "wait until open"
/// function is non-decreasing in the arrival time, so the earliest arrival is
/// always at least as good as any later one.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Leg {
    pub pass_through: NodeIndex,
    pub window: TimeWindow,
    pub inbound_hours: f64,
    pub outbound_hours: f64,
}

/// Everything needed to evaluate a single destination.
#[derive(Debug, Clone, PartialEq)]
pub struct Route {
    pub destination: NodeIndex,
    pub window: TimeWindow,
    pub priority: Priority,
    pub legs: Vec<Leg>,
}

/// A validated delivery network.
#[derive(Debug, Clone)]
pub struct Graph {
    nodes: Vec<Node>,
    edges: Vec<(NodeIndex, NodeIndex)>,
    ids: HashMap<String, NodeIndex>,
    routes: Vec<Route>,
    total_priority: f64,
}

impl Graph {
    /// Validate and build a graph.
    ///
    /// Rules: ids unique; edges only `source -> pass-through` and
    /// `pass-through -> destination`, none repeated; every source has an
    /// outgoing edge, every pass-through has both incoming and outgoing edges,
    /// every destination has an incoming edge (so the node kinds agree with the
    /// in/out-degree definition); weakly connected; total priority > 0.
    pub fn new(nodes: Vec<Node>, edges: Vec<(NodeIndex, NodeIndex)>) -> Result<Self, ModelError> {
        if nodes.is_empty() {
            return Err(ModelError::EmptyGraph);
        }

        let mut ids = HashMap::with_capacity(nodes.len());
        for (i, node) in nodes.iter().enumerate() {
            if ids.insert(node.id().to_owned(), NodeIndex(i)).is_some() {
                return Err(ModelError::DuplicateId(node.id().to_owned()));
            }
        }

        let mut preds: Vec<Vec<NodeIndex>> = vec![Vec::new(); nodes.len()];
        let mut succs: Vec<Vec<NodeIndex>> = vec![Vec::new(); nodes.len()];
        let mut seen = HashSet::with_capacity(edges.len());
        for &(from, to) in &edges {
            let (from_node, to_node) = match (nodes.get(from.0), nodes.get(to.0)) {
                (Some(f), Some(t)) => (f, t),
                (None, _) => return Err(ModelError::IndexOutOfRange(from.0)),
                (_, None) => return Err(ModelError::IndexOutOfRange(to.0)),
            };
            match (from_node.kind(), to_node.kind()) {
                (NodeKind::Source, NodeKind::PassThrough)
                | (NodeKind::PassThrough, NodeKind::Destination) => {}
                _ => {
                    return Err(ModelError::InvalidEdge {
                        from: from_node.id().to_owned(),
                        to: to_node.id().to_owned(),
                    })
                }
            }
            if !seen.insert((from, to)) {
                return Err(ModelError::DuplicateEdge {
                    from: from_node.id().to_owned(),
                    to: to_node.id().to_owned(),
                });
            }
            succs[from.0].push(to);
            preds[to.0].push(from);
        }

        for (i, node) in nodes.iter().enumerate() {
            let problem = match node.kind() {
                NodeKind::Source if succs[i].is_empty() => Some("is a source with no outgoing edge"),
                NodeKind::PassThrough if preds[i].is_empty() => {
                    Some("is a pass-through with no incoming edge")
                }
                NodeKind::PassThrough if succs[i].is_empty() => {
                    Some("is a pass-through with no outgoing edge")
                }
                NodeKind::Destination if preds[i].is_empty() => {
                    Some("is a destination with no incoming edge")
                }
                _ => None,
            };
            if let Some(problem) = problem {
                return Err(ModelError::DanglingNode {
                    id: node.id().to_owned(),
                    problem,
                });
            }
        }

        if !is_weakly_connected(nodes.len(), &preds, &succs) {
            return Err(ModelError::Disconnected);
        }

        let mut routes = Vec::new();
        let mut total_priority = 0.0;
        for (i, node) in nodes.iter().enumerate() {
            if let Node::Destination {
                location,
                window,
                priority,
                ..
            } = node
            {
                total_priority += priority.value();
                let mut legs = Vec::with_capacity(preds[i].len());
                for &p in &preds[i] {
                    if let Node::PassThrough {
                        location: p_loc,
                        window: p_window,
                        ..
                    } = &nodes[p.0]
                    {
                        // Non-empty by the degree check above.
                        let inbound_hours = preds[p.0]
                            .iter()
                            .map(|s| nodes[s.0].location().travel_hours(*p_loc))
                            .fold(f64::INFINITY, f64::min);
                        legs.push(Leg {
                            pass_through: p,
                            window: *p_window,
                            inbound_hours,
                            outbound_hours: p_loc.travel_hours(*location),
                        });
                    }
                }
                routes.push(Route {
                    destination: NodeIndex(i),
                    window: *window,
                    priority: *priority,
                    legs,
                });
            }
        }
        if total_priority <= 0.0 {
            return Err(ModelError::ZeroTotalPriority);
        }

        Ok(Self {
            nodes,
            edges,
            ids,
            routes,
            total_priority,
        })
    }

    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn node(&self, index: NodeIndex) -> Option<&Node> {
        self.nodes.get(index.0)
    }

    pub fn index_of(&self, id: &str) -> Option<NodeIndex> {
        self.ids.get(id).copied()
    }

    pub fn edges(&self) -> &[(NodeIndex, NodeIndex)] {
        &self.edges
    }

    /// One route per destination, in node order.
    pub fn routes(&self) -> &[Route] {
        &self.routes
    }

    pub fn total_priority(&self) -> f64 {
        self.total_priority
    }
}

/// Breadth-first search ignoring edge direction.
pub fn is_weakly_connected(
    node_count: usize,
    preds: &[Vec<NodeIndex>],
    succs: &[Vec<NodeIndex>],
) -> bool {
    if node_count == 0 {
        return true;
    }
    let mut visited = vec![false; node_count];
    let mut queue = VecDeque::from([0usize]);
    visited[0] = true;
    let mut count = 1;
    while let Some(current) = queue.pop_front() {
        let neighbours = preds
            .get(current)
            .into_iter()
            .flatten()
            .chain(succs.get(current).into_iter().flatten());
        for n in neighbours {
            if !visited[n.0] {
                visited[n.0] = true;
                count += 1;
                queue.push_back(n.0);
            }
        }
    }
    count == node_count
}

// ---------------------------------------------------------------------------
// Upgrade sets
// ---------------------------------------------------------------------------

/// A set of nodes whose window is replaced by [`TimeWindow::ALWAYS_OPEN`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpgradeSet {
    flags: Vec<bool>,
}

impl UpgradeSet {
    pub fn new(node_count: usize) -> Self {
        Self {
            flags: vec![false; node_count],
        }
    }

    pub fn from_indices(node_count: usize, indices: &[NodeIndex]) -> Result<Self, ModelError> {
        let mut set = Self::new(node_count);
        for &i in indices {
            if i.0 >= node_count {
                return Err(ModelError::IndexOutOfRange(i.0));
            }
            set.flags[i.0] = true;
        }
        Ok(set)
    }

    pub fn contains(&self, index: NodeIndex) -> bool {
        self.flags.get(index.0).copied().unwrap_or(false)
    }

    /// Returns `true` if the node was newly added (`false` if already present or out of range).
    pub fn insert(&mut self, index: NodeIndex) -> bool {
        match self.flags.get_mut(index.0) {
            Some(flag) if !*flag => {
                *flag = true;
                true
            }
            _ => false,
        }
    }

    /// Returns `true` if the node was present.
    pub fn remove(&mut self, index: NodeIndex) -> bool {
        match self.flags.get_mut(index.0) {
            Some(flag) if *flag => {
                *flag = false;
                true
            }
            _ => false,
        }
    }

    pub fn clear(&mut self) {
        self.flags.iter_mut().for_each(|f| *f = false);
    }

    pub fn len(&self) -> usize {
        self.flags.iter().filter(|f| **f).count()
    }

    pub fn is_empty(&self) -> bool {
        !self.flags.iter().any(|f| *f)
    }

    /// Members in ascending order.
    pub fn indices(&self) -> Vec<NodeIndex> {
        self.flags
            .iter()
            .enumerate()
            .filter(|(_, f)| **f)
            .map(|(i, _)| NodeIndex(i))
            .collect()
    }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

fn effective_window(upgrades: &UpgradeSet, node: NodeIndex, original: TimeWindow) -> TimeWindow {
    if upgrades.contains(node) {
        TimeWindow::ALWAYS_OPEN
    } else {
        original
    }
}

/// Fastest delivery time (hours) to one destination when leaving the sources at
/// `departure`: the minimum over every source and pass-through that can reach it.
pub fn destination_time_to_delivery(route: &Route, departure: f64, upgrades: &UpgradeSet) -> f64 {
    let destination_window = effective_window(upgrades, route.destination, route.window);
    route
        .legs
        .iter()
        .map(|leg| {
            let pass_window = effective_window(upgrades, leg.pass_through, leg.window);
            let mut clock = departure + leg.inbound_hours;
            clock += pass_window.wait_hours(clock);
            clock += leg.outbound_hours;
            clock += destination_window.wait_hours(clock);
            clock - departure
        })
        .fold(f64::INFINITY, f64::min)
}

/// Mean of [`destination_time_to_delivery`] over all departure times.
pub fn average_time_to_delivery(
    route: &Route,
    departures: &DepartureTimes,
    upgrades: &UpgradeSet,
) -> f64 {
    let total: f64 = departures
        .as_slice()
        .iter()
        .map(|&d| destination_time_to_delivery(route, d, upgrades))
        .sum();
    total / departures.len() as f64
}

/// Network objective: `sum_d p_d * avg_ttd(d) / sum_d p_d`.
pub fn weighted_time_to_delivery(
    graph: &Graph,
    departures: &DepartureTimes,
    upgrades: &UpgradeSet,
) -> f64 {
    let weighted: f64 = graph
        .routes()
        .iter()
        .map(|r| r.priority.value() * average_time_to_delivery(r, departures, upgrades))
        .sum();
    weighted / graph.total_priority()
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/// How to search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Strategy {
    /// Exact if within the combination limit, greedy + swap search otherwise.
    #[default]
    Auto,
    /// Evaluate every combination (error if above the limit).
    Exact,
    /// Greedy construction followed by swap local search.
    Greedy,
}

impl FromStr for Strategy {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "auto" => Ok(Strategy::Auto),
            "exact" => Ok(Strategy::Exact),
            "greedy" => Ok(Strategy::Greedy),
            other => Err(format!("unknown strategy `{other}` (expected auto, exact or greedy)")),
        }
    }
}

/// The algorithm that actually produced a result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SolverUsed {
    Exact,
    Greedy,
}

/// Solver tuning knobs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SolverConfig {
    /// Largest `C(candidates, n)` for which exact search is allowed.
    pub exact_max_combinations: u64,
}

impl Default for SolverConfig {
    fn default() -> Self {
        Self {
            exact_max_combinations: 200_000,
        }
    }
}

/// A chosen set of nodes and its objective value.
#[derive(Debug, Clone, PartialEq)]
pub struct Selection {
    /// Ascending node order.
    pub nodes: Vec<NodeIndex>,
    pub objective: f64,
}

/// Full result of [`solve`].
#[derive(Debug, Clone, PartialEq)]
pub struct Solution {
    pub selected: Vec<NodeIndex>,
    pub baseline_objective: f64,
    pub optimized_objective: f64,
    pub solver: SolverUsed,
}

/// Nodes whose window can be replaced: every pass-through and destination, in node order.
pub fn candidates(graph: &Graph) -> Vec<NodeIndex> {
    graph
        .nodes()
        .iter()
        .enumerate()
        .filter(|(_, n)| n.kind() != NodeKind::Source)
        .map(|(i, _)| NodeIndex(i))
        .collect()
}

/// Binomial coefficient `C(n, k)`; `None` on `u64` overflow; `Some(0)` if `k > n`.
pub fn binomial(n: u64, k: u64) -> Option<u64> {
    if k > n {
        return Some(0);
    }
    let k = k.min(n - k);
    let mut result: u128 = 1;
    for i in 0..k {
        // result * (n - i) is always divisible by (i + 1) at this point.
        result = result.checked_mul(u128::from(n - i))? / u128::from(i + 1);
        if result > u128::from(u64::MAX) {
            return None;
        }
    }
    u64::try_from(result).ok()
}

/// Advance `combination` (strictly increasing values in `0..m`) to the next one
/// in lexicographic order. Returns `false` when it was already the last.
pub fn next_combination(combination: &mut [usize], m: usize) -> bool {
    let k = combination.len();
    if k == 0 || m < k {
        return false;
    }
    let mut i = k;
    while i > 0 {
        i -= 1;
        if combination[i] < m - k + i {
            combination[i] += 1;
            for j in i + 1..k {
                combination[j] = combination[j - 1] + 1;
            }
            return true;
        }
    }
    false
}

fn validate_n(graph: &Graph, n: usize) -> Result<Vec<NodeIndex>, SolveError> {
    if n == 0 {
        return Err(SolveError::ZeroSelection);
    }
    let cands = candidates(graph);
    if n > cands.len() {
        return Err(SolveError::TooManyNodes {
            requested: n,
            available: cands.len(),
        });
    }
    Ok(cands)
}

/// Evaluate every `n`-subset of candidates; ties go to the lexicographically first.
pub fn exact_search(
    graph: &Graph,
    departures: &DepartureTimes,
    n: usize,
) -> Result<Selection, SolveError> {
    let cands = validate_n(graph, n)?;
    let m = cands.len();
    let mut combination: Vec<usize> = (0..n).collect();
    let mut set = UpgradeSet::new(graph.node_count());

    let evaluate = |combination: &[usize], set: &mut UpgradeSet| {
        set.clear();
        for &i in combination {
            set.insert(cands[i]);
        }
        weighted_time_to_delivery(graph, departures, set)
    };

    let mut best_combination = combination.clone();
    let mut best_objective = evaluate(&combination, &mut set);
    while next_combination(&mut combination, m) {
        let objective = evaluate(&combination, &mut set);
        if objective < best_objective - IMPROVEMENT_TOLERANCE {
            best_objective = objective;
            best_combination.clone_from(&combination);
        }
    }
    Ok(Selection {
        nodes: best_combination.into_iter().map(|i| cands[i]).collect(),
        objective: best_objective,
    })
}

/// Greedy construction (add the node with the best marginal gain `n` times)
/// followed by a swap local search until no single swap improves the objective.
pub fn greedy_search(
    graph: &Graph,
    departures: &DepartureTimes,
    n: usize,
) -> Result<Selection, SolveError> {
    let cands = validate_n(graph, n)?;
    let mut set = UpgradeSet::new(graph.node_count());
    let mut chosen: Vec<NodeIndex> = Vec::with_capacity(n);

    for _ in 0..n {
        let mut best: Option<(NodeIndex, f64)> = None;
        for &c in &cands {
            if set.contains(c) {
                continue;
            }
            set.insert(c);
            let objective = weighted_time_to_delivery(graph, departures, &set);
            set.remove(c);
            if best.is_none_or(|(_, b)| objective < b - IMPROVEMENT_TOLERANCE) {
                best = Some((c, objective));
            }
        }
        if let Some((c, _)) = best {
            set.insert(c);
            chosen.push(c);
        }
    }

    let mut current = weighted_time_to_delivery(graph, departures, &set);
    loop {
        let mut improved = false;
        #[allow(clippy::needless_range_loop)] // `chosen[position]` is replaced inside the loop
        'scan: for position in 0..chosen.len() {
            let removed = chosen[position];
            for &c in &cands {
                if set.contains(c) {
                    continue;
                }
                set.remove(removed);
                set.insert(c);
                let objective = weighted_time_to_delivery(graph, departures, &set);
                if objective < current - IMPROVEMENT_TOLERANCE {
                    chosen[position] = c;
                    current = objective;
                    improved = true;
                    break 'scan;
                }
                set.remove(c);
                set.insert(removed);
            }
        }
        if !improved {
            break;
        }
    }

    chosen.sort_unstable();
    Ok(Selection {
        nodes: chosen,
        objective: current,
    })
}

/// Pick `n` nodes to upgrade, using the requested strategy.
pub fn solve(
    graph: &Graph,
    departures: &DepartureTimes,
    n: usize,
    strategy: Strategy,
    config: &SolverConfig,
) -> Result<Solution, SolveError> {
    let cands = validate_n(graph, n)?;
    let within_limit = binomial(cands.len() as u64, n as u64)
        .is_some_and(|c| c <= config.exact_max_combinations);

    let solver = match (strategy, within_limit) {
        (Strategy::Exact, false) => {
            return Err(SolveError::ExactTooLarge {
                limit: config.exact_max_combinations,
            })
        }
        (Strategy::Exact, true) | (Strategy::Auto, true) => SolverUsed::Exact,
        (Strategy::Greedy, _) | (Strategy::Auto, false) => SolverUsed::Greedy,
    };
    let selection = match solver {
        SolverUsed::Exact => exact_search(graph, departures, n)?,
        SolverUsed::Greedy => greedy_search(graph, departures, n)?,
    };
    let baseline_objective =
        weighted_time_to_delivery(graph, departures, &UpgradeSet::new(graph.node_count()));
    Ok(Solution {
        selected: selection.nodes,
        baseline_objective,
        optimized_objective: selection.objective,
        solver,
    })
}

// ---------------------------------------------------------------------------
// File format
// ---------------------------------------------------------------------------

/// Top-level uploaded JSON document.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphFile {
    pub nodes: Vec<NodeRecord>,
    pub edges: Vec<EdgeRecord>,
    /// Optional departure hours (each in `[0, 24)`); defaults to `0..=23`.
    pub departure_hours: Option<Vec<f64>>,
}

/// One node as written in the file.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NodeRecord {
    Source {
        id: String,
        latitude: f64,
        longitude: f64,
    },
    PassThrough {
        id: String,
        latitude: f64,
        longitude: f64,
        open_from: i64,
        open_until: i64,
    },
    Destination {
        id: String,
        latitude: f64,
        longitude: f64,
        open_from: i64,
        open_until: i64,
        priority: f64,
    },
}

/// One directed edge as written in the file.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgeRecord {
    pub from: String,
    pub to: String,
}

impl NodeRecord {
    /// Validate the raw values and build a [`Node`].
    pub fn into_node(self) -> Result<Node, ModelError> {
        match self {
            NodeRecord::Source {
                id,
                latitude,
                longitude,
            } => Ok(Node::Source {
                id,
                location: Coordinate::new(latitude, longitude)?,
            }),
            NodeRecord::PassThrough {
                id,
                latitude,
                longitude,
                open_from,
                open_until,
            } => Ok(Node::PassThrough {
                id,
                location: Coordinate::new(latitude, longitude)?,
                window: TimeWindow::new(open_from, open_until)?,
            }),
            NodeRecord::Destination {
                id,
                latitude,
                longitude,
                open_from,
                open_until,
                priority,
            } => Ok(Node::Destination {
                id,
                location: Coordinate::new(latitude, longitude)?,
                window: TimeWindow::new(open_from, open_until)?,
                priority: Priority::new(priority)?,
            }),
        }
    }
}

/// A validated graph plus the departure times to evaluate it at.
#[derive(Debug, Clone)]
pub struct ParsedInput {
    pub graph: Graph,
    pub departures: DepartureTimes,
}

impl GraphFile {
    /// Validate everything and build the graph.
    pub fn into_input(self) -> Result<ParsedInput, InputError> {
        let mut nodes = Vec::with_capacity(self.nodes.len());
        for record in self.nodes {
            nodes.push(record.into_node()?);
        }

        let mut by_id: HashMap<&str, NodeIndex> = HashMap::with_capacity(nodes.len());
        for (i, node) in nodes.iter().enumerate() {
            by_id.entry(node.id()).or_insert(NodeIndex(i));
        }
        let mut edges = Vec::with_capacity(self.edges.len());
        for edge in &self.edges {
            let from = by_id
                .get(edge.from.as_str())
                .copied()
                .ok_or_else(|| InputError::UnknownNodeId(edge.from.clone()))?;
            let to = by_id
                .get(edge.to.as_str())
                .copied()
                .ok_or_else(|| InputError::UnknownNodeId(edge.to.clone()))?;
            edges.push((from, to));
        }

        let departures = match self.departure_hours {
            Some(hours) => DepartureTimes::new(hours)?,
            None => DepartureTimes::every_hour(),
        };
        Ok(ParsedInput {
            graph: Graph::new(nodes, edges)?,
            departures,
        })
    }
}

/// Parse the bytes of an uploaded file (JSON) into a validated [`ParsedInput`].
pub fn parse_graph_file(bytes: &[u8]) -> Result<ParsedInput, InputError> {
    let file: GraphFile =
        serde_json::from_slice(bytes).map_err(|e| InputError::Json(e.to_string()))?;
    file.into_input()
}

/// Body of a successful `/api/analyze` response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnalyzeResponse {
    /// Ids of the nodes to switch to `[0, 23]`.
    pub selected: Vec<String>,
    pub n: usize,
    pub solver: SolverUsed,
    pub baseline_weighted_hours: f64,
    pub optimized_weighted_hours: f64,
}

/// Convert a [`Solution`] into the ids-based response.
pub fn build_response(graph: &Graph, n: usize, solution: &Solution) -> AnalyzeResponse {
    AnalyzeResponse {
        selected: solution
            .selected
            .iter()
            .filter_map(|i| graph.node(*i))
            .map(|node| node.id().to_owned())
            .collect(),
        n,
        solver: solution.solver,
        baseline_weighted_hours: solution.baseline_objective,
        optimized_weighted_hours: solution.optimized_objective,
    }
}

/// The whole pipeline behind `/api/analyze`: parse, validate, solve, report.
pub fn analyze_bytes(
    bytes: &[u8],
    n: usize,
    strategy: Strategy,
    config: &SolverConfig,
) -> Result<AnalyzeResponse, AnalyzeError> {
    let input = parse_graph_file(bytes)?;
    let solution = solve(&input.graph, &input.departures, n, strategy, config)?;
    Ok(build_response(&input.graph, n, &solution))
}

// ---------------------------------------------------------------------------
// Server settings (environment variables; no recompilation needed)
// ---------------------------------------------------------------------------

pub const ENV_HOST: &str = "MEDROUTE_HOST";
pub const ENV_PORT: &str = "MEDROUTE_PORT";
pub const ENV_MAX_UPLOAD_BYTES: &str = "MEDROUTE_MAX_UPLOAD_BYTES";
pub const ENV_EXACT_MAX_COMBINATIONS: &str = "MEDROUTE_EXACT_MAX_COMBINATIONS";

/// A malformed environment variable.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("environment variable {name}=`{value}` is invalid: expected {expected}")]
pub struct SettingsError {
    pub name: &'static str,
    pub value: String,
    pub expected: &'static str,
}

/// Runtime configuration of the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServerSettings {
    pub host: IpAddr,
    pub port: u16,
    pub max_upload_bytes: usize,
    pub solver: SolverConfig,
}

impl Default for ServerSettings {
    fn default() -> Self {
        Self {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 8080,
            max_upload_bytes: 10 * 1024 * 1024,
            solver: SolverConfig::default(),
        }
    }
}

fn parse_setting<T: FromStr, F: Fn(&str) -> Option<String>>(
    lookup: &F,
    name: &'static str,
    expected: &'static str,
    default: T,
) -> Result<T, SettingsError> {
    match lookup(name) {
        None => Ok(default),
        Some(value) => value.trim().parse().map_err(|_| SettingsError {
            name,
            value,
            expected,
        }),
    }
}

impl ServerSettings {
    /// Build settings from any variable lookup (used by tests).
    pub fn from_lookup<F: Fn(&str) -> Option<String>>(lookup: F) -> Result<Self, SettingsError> {
        let d = Self::default();
        Ok(Self {
            host: parse_setting(&lookup, ENV_HOST, "an IP address", d.host)?,
            port: parse_setting(&lookup, ENV_PORT, "a port number 0-65535", d.port)?,
            max_upload_bytes: parse_setting(
                &lookup,
                ENV_MAX_UPLOAD_BYTES,
                "a positive integer",
                d.max_upload_bytes,
            )?,
            solver: SolverConfig {
                exact_max_combinations: parse_setting(
                    &lookup,
                    ENV_EXACT_MAX_COMBINATIONS,
                    "a non-negative integer",
                    d.solver.exact_max_combinations,
                )?,
            },
        })
    }

    /// Build settings from the process environment.
    pub fn from_env() -> Result<Self, SettingsError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    pub fn socket_addr(&self) -> SocketAddr {
        SocketAddr::new(self.host, self.port)
    }
}