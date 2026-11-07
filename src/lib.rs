use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

// ==========================================
// 0. Constants
// ==========================================

/// Travel speed along every edge, in km/h.
pub const TRAVEL_SPEED_KPH: f64 = 60.0;
/// Mean Earth radius in km, used for great-circle distances.
pub const EARTH_RADIUS_KM: f64 = 6371.0088;
/// First and last (inclusive) integer start hours sampled for "business hours".
pub const BUSINESS_START_HOUR: u32 = 9;
pub const BUSINESS_END_HOUR: u32 = 17;

// ==========================================
// 1. Core Domain Types
// ==========================================

/// A strongly-typed identifier for a node to prevent accidental misuse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId(pub usize);

/// Represents a collection of Node Identifiers.
#[derive(Debug, Clone, Default)]
pub struct NodeList(pub Vec<NodeId>);

/// A geographic position in decimal degrees: latitude in [-90, 90] (north positive)
/// and longitude in [-180, 180] (east positive). Range checks happen in
/// `TransitGraph::add_node`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coordinates {
    pub lat: f64,
    pub lon: f64,
}

impl Coordinates {
    /// Great-circle (haversine) distance between two coordinates in kilometers,
    /// on a spherical Earth of radius `EARTH_RADIUS_KM`.
    pub fn distance_to(&self, other: &Coordinates) -> f64 {
        let (lat1, lat2) = (self.lat.to_radians(), other.lat.to_radians());
        let dlat = lat2 - lat1;
        let dlon = (other.lon - self.lon).to_radians();
        let a = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlon / 2.0).sin().powi(2);
        2.0 * EARTH_RADIUS_KM * a.sqrt().min(1.0).asin()
    }
}

/// A safe wrapper for operational hours ensuring 0 <= a < b <= 24.
/// The node is open on the half-open interval [start, end).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeInterval {
    start: u8,
    end: u8,
}

impl TimeInterval {
    /// Constructor that enforces domain constraints.
    pub fn new(start: u8, end: u8) -> Result<Self, &'static str> {
        if start < end && end <= 24 {
            Ok(Self { start, end })
        } else {
            Err("Invalid interval: must be 0 <= start < end <= 24")
        }
    }

    pub fn start(&self) -> u8 {
        self.start
    }
    pub fn end(&self) -> u8 {
        self.end
    }

    /// Checks if a given time (in hours) falls within the half-open interval [start, end).
    pub fn is_open_at(&self, time: f64) -> bool {
        time >= (self.start as f64) && time < (self.end as f64)
    }
}

// ==========================================
// 2. Graph Node Data
// ==========================================

/// The "added information" for each node, encapsulating relationships,
/// operational hours, and location.
#[derive(Debug, Clone)]
pub struct NodeMetadata {
    pub parents: NodeList,
    pub interval: TimeInterval,
    pub coordinates: Coordinates,
}

// ==========================================
// 3. Graph Structure
// ==========================================

/// The overall Directed Acyclic Graph. Edges point parent -> child, and travel
/// is only possible in that direction.
#[derive(Debug, Clone, Default)]
pub struct TransitGraph {
    /// Maps each node identifier to its metadata.
    nodes: HashMap<NodeId, NodeMetadata>,
}

impl TransitGraph {
    pub fn new() -> Self {
        Self { nodes: HashMap::new() }
    }

    /// Inserts (or replaces) a node.
    ///
    /// Validation: coordinates must be finite and a valid latitude/longitude, every
    /// parent must already exist in the graph, a node cannot be its own parent, and the result must remain acyclic
    /// (on failure the graph is left unchanged). Duplicate parents are collapsed.
    pub fn add_node(&mut self, id: NodeId, mut meta: NodeMetadata) -> Result<(), &'static str> {
        let c = meta.coordinates;
        if !c.lat.is_finite() || !c.lon.is_finite() {
            return Err("Coordinates must be finite");
        }
        if !(-90.0..=90.0).contains(&c.lat) || !(-180.0..=180.0).contains(&c.lon) {
            return Err("Latitude must be in [-90, 90] and longitude in [-180, 180]");
        }
        let mut seen = HashSet::new();
        meta.parents.0.retain(|p| seen.insert(*p));
        for p in &meta.parents.0 {
            if *p == id {
                return Err("A node cannot be its own parent");
            }
            if !self.nodes.contains_key(p) {
                return Err("Parent node does not exist");
            }
        }

        let previous = self.nodes.insert(id, meta);
        if !is_acyclic(&self.nodes) {
            match previous {
                Some(old) => {
                    self.nodes.insert(id, old);
                }
                None => {
                    self.nodes.remove(&id);
                }
            }
            return Err("Insertion would create a cycle");
        }
        Ok(())
    }

    pub fn get_node(&self, id: &NodeId) -> Option<&NodeMetadata> {
        self.nodes.get(id)
    }

    /// All node ids, sorted ascending for deterministic behaviour.
    pub fn all_nodes(&self) -> NodeList {
        let mut ids: Vec<NodeId> = self.nodes.keys().copied().collect();
        ids.sort_by_key(|n| n.0);
        NodeList(ids)
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    /// True if the directed edge parent -> child exists.
    pub fn has_edge(&self, parent: NodeId, child: NodeId) -> bool {
        self.nodes
            .get(&child)
            .map_or(false, |m| m.parents.0.contains(&parent))
    }

    /// Adjacency list parent -> sorted children.
    pub fn children_map(&self) -> HashMap<NodeId, Vec<NodeId>> {
        let mut map: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
        for (id, meta) in &self.nodes {
            for p in &meta.parents.0 {
                map.entry(*p).or_default().push(*id);
            }
        }
        for kids in map.values_mut() {
            kids.sort_by_key(|n| n.0);
        }
        map
    }

    /// True if a directed path from `from` to `to` exists (a node reaches itself).
    pub fn has_path(&self, from: NodeId, to: NodeId) -> bool {
        if from == to {
            return true;
        }
        let children = self.children_map();
        let mut seen = HashSet::new();
        let mut stack = vec![from];
        while let Some(n) = stack.pop() {
            if !seen.insert(n) {
                continue;
            }
            if n == to {
                return true;
            }
            if let Some(kids) = children.get(&n) {
                stack.extend(kids.iter().copied());
            }
        }
        false
    }

    /// Applies a single proposed change, keeping the graph a valid DAG.
    pub fn apply_change(&mut self, change: &GraphChange) -> Result<(), &'static str> {
        match change {
            GraphChange::UpdateHours(id, interval) => {
                let meta = self.nodes.get_mut(id).ok_or("Unknown node")?;
                meta.interval = *interval;
                Ok(())
            }
            GraphChange::AddEdge { parent, child } => {
                if parent == child {
                    return Err("Self-loops are not allowed");
                }
                if !self.nodes.contains_key(parent) || !self.nodes.contains_key(child) {
                    return Err("Unknown node");
                }
                if self.has_edge(*parent, *child) {
                    return Err("Edge already exists");
                }
                if self.has_path(*child, *parent) {
                    return Err("Edge would create a cycle");
                }
                self.nodes.get_mut(child).unwrap().parents.0.push(*parent);
                Ok(())
            }
            GraphChange::RemoveEdge { parent, child } => {
                let meta = self.nodes.get_mut(child).ok_or("Unknown node")?;
                match meta.parents.0.iter().position(|p| p == parent) {
                    Some(pos) => {
                        meta.parents.0.remove(pos);
                        Ok(())
                    }
                    None => Err("Edge does not exist"),
                }
            }
        }
    }
}

/// Kahn's algorithm. Parents missing from the map are ignored.
fn is_acyclic(nodes: &HashMap<NodeId, NodeMetadata>) -> bool {
    let mut indegree: HashMap<NodeId, usize> = HashMap::new();
    let mut kids: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    for (id, meta) in nodes {
        let mut d = 0;
        for p in &meta.parents.0 {
            if nodes.contains_key(p) {
                d += 1;
                kids.entry(*p).or_default().push(*id);
            }
        }
        indegree.insert(*id, d);
    }
    let mut queue: Vec<NodeId> = indegree
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(id, _)| *id)
        .collect();
    let mut visited = 0;
    while let Some(n) = queue.pop() {
        visited += 1;
        if let Some(ks) = kids.get(&n) {
            for k in ks {
                let d = indegree.get_mut(k).unwrap();
                *d -= 1;
                if *d == 0 {
                    queue.push(*k);
                }
            }
        }
    }
    visited == nodes.len()
}

// ==========================================
// 4. API & Analysis
// ==========================================

/// Represents a proposed change to the graph to optimize performance.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphChange {
    /// Modify the open interval of a specific node
    UpdateHours(NodeId, TimeInterval),
    /// Add a new directed edge (parent -> child)
    AddEdge { parent: NodeId, child: NodeId },
    /// Remove an existing directed edge
    RemoveEdge { parent: NodeId, child: NodeId },
}

/// The result returned by the optimization endpoint.
#[derive(Debug, Clone)]
pub struct OptimizationResult {
    pub original_performance: f64,
    pub optimized_performance: f64,
    pub suggested_changes: Vec<GraphChange>,
}

/// Trait defining the core business logic for graph analysis.
pub trait TransitAnalyzer {
    /// Calculates the minimum transit time between two nodes starting at a given hour.
    /// Accounts for travel time at 60 kph, business hours, and node waiting periods.
    fn calculate_transit_time(
        &self,
        graph: &TransitGraph,
        source: NodeId,
        target: NodeId,
        start_time: f64,
    ) -> Option<f64>;

    /// Evaluates the overall performance (average transit time) across all reachable
    /// pairs during business hours (9 to 17).
    fn evaluate_performance(&self, graph: &TransitGraph) -> f64;

    /// Analyzes the graph to propose the optimal set of edge and hour modifications
    /// to minimize the overall performance score (average transit time).
    fn suggest_optimal_changes(&self, graph: &TransitGraph) -> OptimizationResult;
}

// ==========================================
// 5. Implementation
// ==========================================

/// Priority-queue entry: min-heap on time, ties broken by node id.
#[derive(Debug, Clone, Copy, PartialEq)]
struct QueueItem {
    time: f64,
    node: NodeId,
}
impl Eq for QueueItem {}
impl Ord for QueueItem {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .time
            .total_cmp(&self.time)
            .then_with(|| other.node.0.cmp(&self.node.0))
    }
}
impl PartialOrd for QueueItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Time-dependent earliest-arrival Dijkstra from `source`, leaving at `start`.
///
/// Edge rule (u -> v, travel time T = distance / 60): the traveller may wait at u and
/// depart at any time d >= (current time) such that u is open at d and v is open at
/// d + T, i.e. d in [a_u, b_u) and d + T in [a_v, b_v). The earliest feasible
/// departure is d = max(cur, a_u, a_v - T), feasible iff d < min(b_u, b_v - T).
/// Earliest arrival is monotone in `cur` (FIFO), so Dijkstra is exact. Intervals are
/// within one day, so no time past 24h is ever feasible and the search terminates.
///
/// Returns the earliest absolute arrival time at every reachable node
/// (the source maps to `start`). If `target` is given, stops once it is settled.
fn earliest_arrivals(
    graph: &TransitGraph,
    children: &HashMap<NodeId, Vec<NodeId>>,
    source: NodeId,
    start: f64,
    target: Option<NodeId>,
) -> HashMap<NodeId, f64> {
    let mut best: HashMap<NodeId, f64> = HashMap::new();
    if graph.get_node(&source).is_none() {
        return best;
    }
    best.insert(source, start);
    let mut heap = BinaryHeap::new();
    heap.push(QueueItem { time: start, node: source });

    while let Some(QueueItem { time, node }) = heap.pop() {
        if best.get(&node).map_or(true, |&b| time > b) {
            continue; // stale entry
        }
        if Some(node) == target {
            break;
        }
        let u = match graph.get_node(&node) {
            Some(u) => u,
            None => continue,
        };
        let Some(kids) = children.get(&node) else { continue };
        for &child in kids {
            let Some(v) = graph.get_node(&child) else { continue };
            let travel = u.coordinates.distance_to(&v.coordinates) / TRAVEL_SPEED_KPH;
            let (ua, ub) = (u.interval.start() as f64, u.interval.end() as f64);
            let (va, vb) = (v.interval.start() as f64, v.interval.end() as f64);
            let depart = time.max(ua).max(va - travel);
            let latest = ub.min(vb - travel);
            if depart < latest {
                let arrival = depart + travel;
                if best.get(&child).map_or(true, |&b| arrival < b) {
                    best.insert(child, arrival);
                    heap.push(QueueItem { time: arrival, node: child });
                }
            }
        }
    }
    best
}

/// Aggregated transit-time samples over all (start hour, ordered pair) combinations
/// that are reachable. Self-pairs are excluded.
struct Stats {
    sum: f64,
    count: usize,
    /// Per ordered pair: (sum of transit times over hours, number of reachable hours)
    pairs: HashMap<(NodeId, NodeId), (f64, usize)>,
}

impl Stats {
    fn average(&self) -> f64 {
        if self.count == 0 {
            0.0
        } else {
            self.sum / self.count as f64
        }
    }
}

/// Tunable limits for the greedy optimizer. Without a budget the "optimum" is
/// trivially "open everything 24h and connect every pair", so changes are capped.
#[derive(Debug, Clone)]
pub struct OptimizerConfig {
    /// Maximum number of changes in the suggestion.
    pub max_changes: usize,
    /// Maximum shortcut-edge candidates scored per greedy round.
    pub max_edge_candidates: usize,
    /// A change must lower the average by more than this to be accepted.
    pub min_improvement: f64,
}

impl Default for OptimizerConfig {
    fn default() -> Self {
        Self { max_changes: 5, max_edge_candidates: 25, min_improvement: 1e-9 }
    }
}

#[derive(Debug, Clone, Default)]
pub struct GraphService {
    pub config: OptimizerConfig,
}

impl GraphService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_config(config: OptimizerConfig) -> Self {
        Self { config }
    }

    fn stats(&self, graph: &TransitGraph) -> Stats {
        let children = graph.children_map();
        let ids = graph.all_nodes().0;
        let mut stats = Stats { sum: 0.0, count: 0, pairs: HashMap::new() };
        for hour in BUSINESS_START_HOUR..=BUSINESS_END_HOUR {
            let start = hour as f64;
            for &s in &ids {
                let arrivals = earliest_arrivals(graph, &children, s, start, None);
                // Iterate in sorted id order so float summation is deterministic.
                for &t in &ids {
                    if t == s {
                        continue;
                    }
                    if let Some(&arr) = arrivals.get(&t) {
                        let tt = arr - start;
                        stats.sum += tt;
                        stats.count += 1;
                        let e = stats.pairs.entry((s, t)).or_insert((0.0, 0));
                        e.0 += tt;
                        e.1 += 1;
                    }
                }
            }
        }
        stats
    }

    /// Candidate changes for one greedy round.
    fn candidates(&self, graph: &TransitGraph, stats: &Stats) -> Vec<GraphChange> {
        let mut out = Vec::new();
        let mut seen: HashSet<(usize, u8, u8)> = HashSet::new();

        // Hour candidates: extend opening hours earlier / later / to the full day.
        for id in graph.all_nodes().0 {
            let iv = graph.get_node(&id).unwrap().interval;
            let (a, b) = (iv.start(), iv.end());
            let mut options = Vec::new();
            if a > 0 {
                options.push((a - 1, b));
            }
            if b < 24 {
                options.push((a, b + 1));
            }
            if a > 0 || b < 24 {
                options.push((0, 24));
            }
            for (na, nb) in options {
                if let Ok(new_iv) = TimeInterval::new(na, nb) {
                    if seen.insert((id.0, na, nb)) {
                        out.push(GraphChange::UpdateHours(id, new_iv));
                    }
                }
            }
        }

        // Edge candidates: shortcuts between non-adjacent pairs whose direct travel
        // time beats the current average transit time, ranked by potential saving.
        let mut ranked: Vec<(f64, NodeId, NodeId)> = Vec::new();
        for (&(s, t), &(sum, n)) in &stats.pairs {
            if graph.has_edge(s, t) {
                continue;
            }
            let (ms, mt) = (graph.get_node(&s).unwrap(), graph.get_node(&t).unwrap());
            let direct = ms.coordinates.distance_to(&mt.coordinates) / TRAVEL_SPEED_KPH;
            let saving = sum / n as f64 - direct;
            if saving > self.config.min_improvement {
                ranked.push((saving, s, t));
            }
        }
        ranked.sort_by(|x, y| {
            y.0.total_cmp(&x.0)
                .then(x.1 .0.cmp(&y.1 .0))
                .then(x.2 .0.cmp(&y.2 .0))
        });
        ranked.truncate(self.config.max_edge_candidates);
        for (_, s, t) in ranked {
            out.push(GraphChange::AddEdge { parent: s, child: t });
        }
        out
    }
}

impl TransitAnalyzer for GraphService {
    /// Minimum transit time (arrival - start_time, waiting included) from `source` to
    /// `target` when starting at `start_time` (hours, fractional allowed).
    /// Returns `Some(0.0)` for source == target (if the node exists) and `None` if
    /// either node is unknown, the target is unreachable, or `start_time` is not finite.
    fn calculate_transit_time(
        &self,
        graph: &TransitGraph,
        source: NodeId,
        target: NodeId,
        start_time: f64,
    ) -> Option<f64> {
        if !start_time.is_finite() {
            return None;
        }
        graph.get_node(&source)?;
        graph.get_node(&target)?;
        if source == target {
            return Some(0.0);
        }
        let children = graph.children_map();
        let arrivals = earliest_arrivals(graph, &children, source, start_time, Some(target));
        arrivals.get(&target).map(|&arr| arr - start_time)
    }

    /// Average transit time over every ordered pair of distinct nodes that is
    /// reachable, sampled at each integer start hour 9..=17. (hour, pair) samples
    /// that are unreachable are excluded. Returns 0.0 if there are no such samples.
    fn evaluate_performance(&self, graph: &TransitGraph) -> f64 {
        self.stats(graph).average()
    }

    /// Greedy optimizer. Each round scores every candidate change (hour extensions and
    /// shortcut edges) by re-evaluating performance, then applies the best one.
    /// A candidate is only accepted if it (a) does not reduce the number of reachable
    /// (hour, pair) samples, so connectivity can't be "optimized away", and (b) lowers
    /// the average by more than `min_improvement`. Stops after `max_changes` or when
    /// no candidate helps. Applying `suggested_changes` in order to the input graph
    /// yields a graph whose performance equals `optimized_performance`.
    fn suggest_optimal_changes(&self, graph: &TransitGraph) -> OptimizationResult {
        let mut current = graph.clone();
        let mut cur_stats = self.stats(&current);
        let original = cur_stats.average();
        let mut changes = Vec::new();

        if cur_stats.count > 0 {
            for _ in 0..self.config.max_changes {
                let mut best: Option<(GraphChange, TransitGraph, Stats)> = None;
                for cand in self.candidates(&current, &cur_stats) {
                    let mut g = current.clone();
                    if g.apply_change(&cand).is_err() {
                        continue;
                    }
                    let s = self.stats(&g);
                    if s.count < cur_stats.count {
                        continue;
                    }
                    if s.average() > cur_stats.average() - self.config.min_improvement {
                        continue;
                    }
                    // Scores within 1e-12 are ties (floating-point noise); keep the earlier candidate.
                    if best.as_ref().map_or(true, |(_, _, b)| s.average() < b.average() - 1e-12) {
                        best = Some((cand, g, s));
                    }
                }
                match best {
                    Some((c, g, s)) => {
                        changes.push(c);
                        current = g;
                        cur_stats = s;
                    }
                    None => break,
                }
            }
        }

        OptimizationResult {
            original_performance: original,
            optimized_performance: cur_stats.average(),
            suggested_changes: changes,
        }
    }
}