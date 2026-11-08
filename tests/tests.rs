//! Tests for every public function of `medroute`, plus end-to-end tests that
//! start the real server binary and talk HTTP to it.
//!
//! Many scenarios put all nodes at the same coordinate so that transit time is
//! exactly zero and the expected delivery times can be worked out by hand from
//! the opening windows alone.

use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use medroute::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-9,
        "expected {expected}, got {actual}"
    );
}

fn coord(lat: f64, lon: f64) -> Coordinate {
    Coordinate::new(lat, lon).unwrap()
}

fn win(a: i64, b: i64) -> TimeWindow {
    TimeWindow::new(a, b).unwrap()
}

fn src(id: &str, lat: f64, lon: f64) -> Node {
    Node::Source {
        id: id.to_owned(),
        location: coord(lat, lon),
    }
}

fn pass(id: &str, lat: f64, lon: f64, a: i64, b: i64) -> Node {
    Node::PassThrough {
        id: id.to_owned(),
        location: coord(lat, lon),
        window: win(a, b),
        solar_window: TimeWindow::ALWAYS_OPEN,
    }
}

fn dest(id: &str, lat: f64, lon: f64, a: i64, b: i64, p: f64) -> Node {
    Node::Destination {
        id: id.to_owned(),
        location: coord(lat, lon),
        window: win(a, b),
        solar_window: TimeWindow::ALWAYS_OPEN,
        priority: Priority::new(p).unwrap(),
    }
}

fn ix(i: usize) -> NodeIndex {
    NodeIndex::new(i)
}

fn edges(pairs: &[(usize, usize)]) -> Vec<(NodeIndex, NodeIndex)> {
    pairs.iter().map(|&(a, b)| (ix(a), ix(b))).collect()
}

fn hours(h: &[f64]) -> DepartureTimes {
    DepartureTimes::new(h.to_vec()).unwrap()
}

/// S(0) -> P(1) [8,10] -> D(2) [12,14], everything at (0,0): zero transit time.
fn zero_transit_chain() -> Graph {
    Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 0.0, 8, 10),
            dest("D", 0.0, 0.0, 12, 14, 1.0),
        ],
        edges(&[(0, 1), (1, 2)]),
    )
    .unwrap()
}

const ZERO_CHAIN_JSON: &str = r#"{
  "nodes": [
    {"id": "S", "kind": "source", "latitude": 0, "longitude": 0},
    {"id": "P", "kind": "pass_through", "latitude": 0, "longitude": 0, "open_from": 8, "open_until": 9},
    {"id": "D", "kind": "destination", "latitude": 0, "longitude": 0, "open_from": 12, "open_until": 14, "priority": 1}
  ],
  "edges": [{"from": "S", "to": "P"}, {"from": "P", "to": "D"}]
}"#;

// Hand-computed for ZERO_CHAIN_JSON, zero transit, averaged over departures 0..=23
// (P open [8,10), D open [12,15)):
//   no upgrade : 348/24 = 14.5
//   upgrade D  : 253/24
//   upgrade P  : 231/24 = 9.625   <- best single node
//   both       : 0

/// Tiny deterministic generator so the randomised tests are reproducible.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// Random valid network: sources `0..ns`, pass-throughs, then destinations.
fn random_graph(seed: u64, ns: usize, np: usize, nd: usize) -> Graph {
    let mut rng = Lcg(seed);
    let mut nodes = Vec::new();
    let place = |rng: &mut Lcg| {
        (
            rng.below(200) as f64 / 100.0 - 1.0,
            rng.below(200) as f64 / 100.0 - 1.0,
        )
    };
    for i in 0..ns {
        let (la, lo) = place(&mut rng);
        nodes.push(src(&format!("s{i}"), la, lo));
    }
    for i in 0..np {
        let (la, lo) = place(&mut rng);
        let a = rng.below(23) as i64;
        let b = a + 1 + rng.below((23 - a) as u64) as i64;
        nodes.push(pass(&format!("p{i}"), la, lo, a, b));
    }
    for i in 0..nd {
        let (la, lo) = place(&mut rng);
        let a = rng.below(23) as i64;
        let b = a + 1 + rng.below((23 - a) as u64) as i64;
        let p = 1.0 + rng.below(9) as f64;
        nodes.push(dest(&format!("d{i}"), la, lo, a, b, p));
    }
    let mut set: HashSet<(usize, usize)> = HashSet::new();
    for s in 0..ns {
        set.insert((s, ns)); // every source feeds p0 => connected
    }
    for p in 0..np {
        set.insert((rng.below(ns as u64) as usize, ns + p)); // every pass has a source
        set.insert((ns + p, ns + np + rng.below(nd as u64) as usize)); // ... and a destination
    }
    for d in 0..nd {
        set.insert((ns + rng.below(np as u64) as usize, ns + np + d)); // every dest has a pass
    }
    for _ in 0..(np * 2) {
        set.insert((rng.below(ns as u64) as usize, ns + rng.below(np as u64) as usize));
        set.insert((
            ns + rng.below(np as u64) as usize,
            ns + np + rng.below(nd as u64) as usize,
        ));
    }
    let mut list: Vec<(usize, usize)> = set.into_iter().collect();
    list.sort_unstable();
    Graph::new(nodes, edges(&list)).unwrap()
}

/// Independent brute force over every n-subset via bitmasks.
fn brute_force_best(graph: &Graph, deps: &DepartureTimes, n: usize) -> f64 {
    let cands = candidates(graph);
    let mut best = f64::INFINITY;
    for mask in 0u32..(1u32 << cands.len()) {
        if mask.count_ones() as usize != n {
            continue;
        }
        let chosen: Vec<NodeIndex> = cands
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, c)| *c)
            .collect();
        let set = UpgradeSet::from_indices(graph.node_count(), &chosen).unwrap();
        best = best.min(weighted_time_to_delivery(graph, deps, &set));
    }
    best
}

// ---------------------------------------------------------------------------
// Latitude / Longitude / Coordinate
// ---------------------------------------------------------------------------

#[test]
fn latitude_accepts_valid_range() {
    for v in [-90.0, -12.5, 0.0, 45.0, 90.0] {
        assert_eq!(Latitude::new(v).unwrap().degrees(), v);
    }
}

#[test]
fn latitude_rejects_invalid_values() {
    for v in [90.0001, -90.0001, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(matches!(Latitude::new(v), Err(ModelError::InvalidLatitude(_))));
    }
}

#[test]
fn longitude_accepts_valid_range() {
    for v in [-180.0, -33.3, 0.0, 120.0, 180.0] {
        assert_eq!(Longitude::new(v).unwrap().degrees(), v);
    }
}

#[test]
fn longitude_rejects_invalid_values() {
    for v in [180.0001, -180.0001, f64::NAN, f64::INFINITY] {
        assert!(matches!(Longitude::new(v), Err(ModelError::InvalidLongitude(_))));
    }
}

#[test]
fn coordinate_new_validates_both_parts() {
    assert!(Coordinate::new(10.0, 20.0).is_ok());
    assert_eq!(
        Coordinate::new(91.0, 0.0),
        Err(ModelError::InvalidLatitude(91.0))
    );
    assert_eq!(
        Coordinate::new(0.0, 181.0),
        Err(ModelError::InvalidLongitude(181.0))
    );
}

#[test]
fn coordinate_accessors_return_inputs() {
    let c = coord(12.5, -70.25);
    assert_eq!(c.latitude().degrees(), 12.5);
    assert_eq!(c.longitude().degrees(), -70.25);
}

#[test]
fn distance_is_zero_for_identical_points() {
    assert_eq!(coord(33.0, 44.0).distance_km(coord(33.0, 44.0)), 0.0);
}

#[test]
fn distance_one_degree_on_equator() {
    let expected = 2.0 * std::f64::consts::PI * EARTH_RADIUS_KM / 360.0;
    assert!((coord(0.0, 0.0).distance_km(coord(0.0, 1.0)) - expected).abs() < 1e-6);
    assert!((coord(0.0, 0.0).distance_km(coord(1.0, 0.0)) - expected).abs() < 1e-6);
}

#[test]
fn distance_antipodes_is_half_circumference() {
    let expected = std::f64::consts::PI * EARTH_RADIUS_KM;
    assert!((coord(0.0, 0.0).distance_km(coord(0.0, 180.0)) - expected).abs() < 1e-6);
    assert!((coord(90.0, 0.0).distance_km(coord(-90.0, 0.0)) - expected).abs() < 1e-6);
}

#[test]
fn distance_is_symmetric() {
    let a = coord(-1.29, 36.82);
    let b = coord(0.31, 32.58);
    assert_close(a.distance_km(b), b.distance_km(a));
}

#[test]
fn distance_known_city_pair() {
    // Nairobi -> Kampala is roughly 500 km as the crow flies.
    let d = coord(-1.2921, 36.8219).distance_km(coord(0.3476, 32.5825));
    assert!((480.0..520.0).contains(&d), "got {d}");
}

#[test]
fn travel_hours_uses_sixty_kph() {
    let a = coord(0.0, 0.0);
    let b = coord(0.0, 1.0);
    assert_close(a.travel_hours(b), a.distance_km(b) / 60.0);
    assert_eq!(TRANSIT_SPEED_KPH, 60.0);
    assert_close(a.travel_hours(a), 0.0);
}

// ---------------------------------------------------------------------------
// TimeWindow
// ---------------------------------------------------------------------------

#[test]
fn window_new_accepts_valid() {
    let w = TimeWindow::new(0, 23).unwrap();
    assert_eq!((w.start(), w.end()), (0, 23));
    let w = TimeWindow::new(8, 17).unwrap();
    assert_eq!((w.start(), w.end()), (8, 17));
    assert!(TimeWindow::new(22, 23).is_ok());
}

#[test]
fn window_new_accepts_one_hour_windows() {
    // [a, a] is open for one hour, a:00 up to (a+1):00.
    for a in [0, 5, 23] {
        let w = TimeWindow::new(a, a).unwrap();
        assert_eq!((i64::from(w.start()), i64::from(w.end())), (a, a));
    }
    let w = win(8, 8);
    assert_close(w.wait_hours(8.5), 0.0);
    assert_close(w.wait_hours(9.0), 23.0); // the longest an open window can make you wait
    assert_close(w.wait_hours(7.0), 1.0);
}

#[test]
fn window_new_rejects_invalid() {
    for (a, b) in [(6, 5), (-1, 5), (0, 24), (24, 25), (3, -3), (23, 22)] {
        assert_eq!(
            TimeWindow::new(a, b),
            Err(ModelError::InvalidWindow { start: a, end: b }),
            "[{a}, {b}] should be rejected"
        );
    }
}

#[test]
fn window_always_open_constant_is_zero_to_twenty_three() {
    assert_eq!(TimeWindow::ALWAYS_OPEN, win(0, 23));
}

#[test]
fn window_wait_is_zero_inside_half_open_interval() {
    // [8, 17] means [08:00, 18:00).
    let w = win(8, 17);
    for t in [8.0, 8.5, 12.0, 17.0, 17.5, 17.99] {
        assert_close(w.wait_hours(t), 0.0);
    }
}

#[test]
fn window_end_hour_is_inclusive_but_next_hour_is_closed() {
    let w = win(8, 17);
    assert_close(w.wait_hours(18.0), 14.0); // closed again at 18:00, reopens 08:00
    assert_close(win(8, 8 + 1).wait_hours(10.0), 22.0);
    assert_close(win(8, 9).wait_hours(9.99), 0.0);
}

#[test]
fn window_wait_before_opening_same_day() {
    assert_close(win(8, 17).wait_hours(5.0), 3.0);
    assert_close(win(8, 17).wait_hours(0.0), 8.0);
}

#[test]
fn window_wait_after_closing_until_next_day() {
    assert_close(win(8, 17).wait_hours(18.5), 13.5);
    assert_close(win(8, 17).wait_hours(23.0), 9.0);
}

#[test]
fn window_wait_wraps_beyond_24_hours() {
    assert_close(win(8, 17).wait_hours(29.0), 3.0);
    assert_close(win(8, 17).wait_hours(24.0 * 3.0 + 12.0), 0.0);
}

#[test]
fn window_wait_handles_negative_clock() {
    // -1 h is 23:00 the previous day => wait 9 h until 08:00.
    assert_close(win(8, 17).wait_hours(-1.0), 9.0);
}

#[test]
fn window_wait_tolerates_float_noise_on_boundaries() {
    // Just below the opening time counts as open; just below the closing time counts as closed.
    assert_close(win(8, 17).wait_hours(8.0 - 1e-12), 0.0);
    assert_close(win(8, 17).wait_hours(18.0 - 1e-12), 14.0);
}

#[test]
fn zero_to_twenty_three_is_open_all_day() {
    let w = TimeWindow::ALWAYS_OPEN;
    assert!(w.is_always_open());
    assert!(win(0, 23).is_always_open());
    assert!(!win(0, 22).is_always_open());
    assert!(!win(1, 23).is_always_open());
    for t in [0.0, 12.0, 23.0, 23.5, 23.999_999_999_9, 24.0, 47.9, -0.5] {
        assert_close(w.wait_hours(t), 0.0);
    }
}

// ---------------------------------------------------------------------------
// Priority, NodeIndex, DepartureTimes
// ---------------------------------------------------------------------------

#[test]
fn priority_validation() {
    assert_eq!(Priority::new(0.0).unwrap().value(), 0.0);
    assert_eq!(Priority::new(3.5).unwrap().value(), 3.5);
    for v in [-0.1, f64::NAN, f64::INFINITY] {
        assert!(matches!(Priority::new(v), Err(ModelError::InvalidPriority(_))));
    }
}

#[test]
fn node_index_roundtrip_and_order() {
    assert_eq!(ix(7).get(), 7);
    assert!(ix(1) < ix(2));
}

#[test]
fn departure_times_new_accepts_valid() {
    let d = DepartureTimes::new(vec![0.0, 6.5, 23.99]).unwrap();
    assert_eq!(d.as_slice(), &[0.0, 6.5, 23.99]);
    assert_eq!(d.len(), 3);
    assert!(!d.is_empty());
}

#[test]
fn departure_times_new_rejects_invalid() {
    assert_eq!(DepartureTimes::new(vec![]), Err(ModelError::NoDepartureHours));
    assert_eq!(
        DepartureTimes::new(vec![1.0, 24.0]),
        Err(ModelError::InvalidDepartureHour(24.0))
    );
    assert_eq!(
        DepartureTimes::new(vec![-0.5]),
        Err(ModelError::InvalidDepartureHour(-0.5))
    );
    assert!(matches!(
        DepartureTimes::new(vec![f64::NAN]),
        Err(ModelError::InvalidDepartureHour(_))
    ));
}

#[test]
fn departure_times_every_hour_is_zero_to_twenty_three() {
    let d = DepartureTimes::every_hour();
    assert_eq!(d.len(), 24);
    assert_eq!(d.as_slice()[0], 0.0);
    assert_eq!(d.as_slice()[23], 23.0);
}

// ---------------------------------------------------------------------------
// Node / NodeKind
// ---------------------------------------------------------------------------

#[test]
fn node_accessors_for_source() {
    let n = src("s", 1.0, 2.0);
    assert_eq!(n.id(), "s");
    assert_eq!(n.kind(), NodeKind::Source);
    assert_eq!(n.window(), None);
    assert_eq!(n.priority(), None);
    assert_eq!(n.location(), coord(1.0, 2.0));
}

#[test]
fn node_accessors_for_pass_through() {
    let n = pass("p", 3.0, 4.0, 6, 18);
    assert_eq!(n.id(), "p");
    assert_eq!(n.kind(), NodeKind::PassThrough);
    assert_eq!(n.window(), Some(win(6, 18)));
    assert_eq!(n.priority(), None);
    assert_eq!(n.location(), coord(3.0, 4.0));
}

#[test]
fn node_accessors_for_destination() {
    let n = dest("d", 5.0, 6.0, 9, 11, 4.0);
    assert_eq!(n.id(), "d");
    assert_eq!(n.kind(), NodeKind::Destination);
    assert_eq!(n.window(), Some(win(9, 11)));
    assert_eq!(n.priority().map(Priority::value), Some(4.0));
    assert_eq!(n.location(), coord(5.0, 6.0));
}

#[test]
fn node_kind_display() {
    assert_eq!(NodeKind::Source.to_string(), "source");
    assert_eq!(NodeKind::PassThrough.to_string(), "pass-through");
    assert_eq!(NodeKind::Destination.to_string(), "destination");
}

// ---------------------------------------------------------------------------
// Graph::new and accessors
// ---------------------------------------------------------------------------

#[test]
fn graph_new_builds_valid_network_and_exposes_accessors() {
    let g = zero_transit_chain();
    assert_eq!(g.node_count(), 3);
    assert_eq!(g.nodes().len(), 3);
    assert_eq!(g.edges(), edges(&[(0, 1), (1, 2)]).as_slice());
    assert_eq!(g.index_of("P"), Some(ix(1)));
    assert_eq!(g.index_of("nope"), None);
    assert_eq!(g.node(ix(2)).map(Node::id), Some("D"));
    assert!(g.node(ix(3)).is_none());
    assert_close(g.total_priority(), 1.0);
    assert_eq!(g.routes().len(), 1);
}

#[test]
fn graph_routes_hold_legs_with_fastest_source() {
    // Two sources feed P; the nearer one defines the inbound time.
    let g = Graph::new(
        vec![
            src("near", 0.0, 0.1),
            src("far", 0.0, 2.0),
            pass("P", 0.0, 0.0, 0, 23),
            dest("D", 0.0, 1.0, 0, 23, 2.0),
        ],
        edges(&[(0, 2), (1, 2), (2, 3)]),
    )
    .unwrap();
    let route = &g.routes()[0];
    assert_eq!(route.destination, ix(3));
    assert_eq!(route.window, win(0, 23));
    assert_eq!(route.priority.value(), 2.0);
    assert_eq!(route.legs.len(), 1);
    let leg = route.legs[0];
    assert_eq!(leg.pass_through, ix(2));
    assert_eq!(leg.window, win(0, 23));
    assert_close(leg.inbound_hours, coord(0.0, 0.1).travel_hours(coord(0.0, 0.0)));
    assert_close(leg.outbound_hours, coord(0.0, 0.0).travel_hours(coord(0.0, 1.0)));
}

#[test]
fn graph_routes_one_leg_per_pass_through() {
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P1", 0.0, 0.0, 1, 2),
            pass("P2", 0.0, 0.0, 3, 4),
            dest("D1", 0.0, 0.0, 5, 6, 1.0),
            dest("D2", 0.0, 0.0, 7, 8, 1.0),
        ],
        edges(&[(0, 1), (0, 2), (1, 3), (2, 3), (2, 4)]),
    )
    .unwrap();
    assert_eq!(g.routes().len(), 2);
    assert_eq!(g.routes()[0].legs.len(), 2);
    assert_eq!(g.routes()[1].legs.len(), 1);
}

#[test]
fn graph_rejects_empty() {
    assert_eq!(Graph::new(vec![], vec![]).unwrap_err(), ModelError::EmptyGraph);
}

#[test]
fn graph_rejects_duplicate_ids() {
    let err = Graph::new(
        vec![src("X", 0.0, 0.0), pass("X", 0.0, 0.0, 1, 2), dest("D", 0.0, 0.0, 1, 2, 1.0)],
        edges(&[(0, 1), (1, 2)]),
    )
    .unwrap_err();
    assert_eq!(err, ModelError::DuplicateId("X".into()));
}

#[test]
fn graph_rejects_out_of_range_edge_endpoints() {
    let nodes = || vec![src("S", 0.0, 0.0), pass("P", 0.0, 0.0, 1, 2), dest("D", 0.0, 0.0, 1, 2, 1.0)];
    assert_eq!(
        Graph::new(nodes(), edges(&[(0, 1), (1, 2), (9, 1)])).unwrap_err(),
        ModelError::IndexOutOfRange(9)
    );
    assert_eq!(
        Graph::new(nodes(), edges(&[(0, 1), (1, 2), (0, 7)])).unwrap_err(),
        ModelError::IndexOutOfRange(7)
    );
}

#[test]
fn graph_rejects_edges_that_skip_or_violate_layers() {
    let nodes = || {
        vec![
            src("S", 0.0, 0.0),
            src("S2", 0.0, 0.0),
            pass("P", 0.0, 0.0, 1, 2),
            pass("P2", 0.0, 0.0, 1, 2),
            dest("D", 0.0, 0.0, 1, 2, 1.0),
        ]
    };
    let base = [(0, 2), (1, 2), (2, 4)];
    for bad in [(0, 4), (0, 1), (2, 3), (4, 2), (2, 0), (4, 4), (2, 2)] {
        let mut e = base.to_vec();
        e.push(bad);
        let err = Graph::new(nodes(), edges(&e)).unwrap_err();
        assert!(matches!(err, ModelError::InvalidEdge { .. }), "{bad:?} gave {err:?}");
    }
}

#[test]
fn graph_rejects_duplicate_edges() {
    let err = Graph::new(
        vec![src("S", 0.0, 0.0), pass("P", 0.0, 0.0, 1, 2), dest("D", 0.0, 0.0, 1, 2, 1.0)],
        edges(&[(0, 1), (1, 2), (0, 1)]),
    )
    .unwrap_err();
    assert_eq!(
        err,
        ModelError::DuplicateEdge {
            from: "S".into(),
            to: "P".into()
        }
    );
}

#[test]
fn graph_rejects_dangling_nodes() {
    // Source without an outgoing edge.
    let err = Graph::new(
        vec![src("S", 0.0, 0.0), src("S2", 0.0, 0.0), pass("P", 0.0, 0.0, 1, 2), dest("D", 0.0, 0.0, 1, 2, 1.0)],
        edges(&[(0, 2), (2, 3)]),
    )
    .unwrap_err();
    assert!(matches!(err, ModelError::DanglingNode { ref id, .. } if id == "S2"));

    // Pass-through without an incoming edge.
    let err = Graph::new(
        vec![src("S", 0.0, 0.0), pass("P1", 0.0, 0.0, 1, 2), pass("P2", 0.0, 0.0, 1, 2), dest("D", 0.0, 0.0, 1, 2, 1.0)],
        edges(&[(0, 1), (1, 3), (2, 3)]),
    )
    .unwrap_err();
    assert!(matches!(err, ModelError::DanglingNode { ref id, .. } if id == "P2"));

    // Pass-through without an outgoing edge.
    let err = Graph::new(
        vec![src("S", 0.0, 0.0), pass("P1", 0.0, 0.0, 1, 2), pass("P2", 0.0, 0.0, 1, 2), dest("D", 0.0, 0.0, 1, 2, 1.0)],
        edges(&[(0, 1), (0, 2), (1, 3)]),
    )
    .unwrap_err();
    assert!(matches!(err, ModelError::DanglingNode { ref id, .. } if id == "P2"));

    // Destination without an incoming edge.
    let err = Graph::new(
        vec![src("S", 0.0, 0.0), pass("P", 0.0, 0.0, 1, 2), dest("D", 0.0, 0.0, 1, 2, 1.0), dest("D2", 0.0, 0.0, 1, 2, 1.0)],
        edges(&[(0, 1), (1, 2)]),
    )
    .unwrap_err();
    assert!(matches!(err, ModelError::DanglingNode { ref id, .. } if id == "D2"));

    // A lone node can never satisfy its role.
    assert!(matches!(
        Graph::new(vec![src("S", 0.0, 0.0)], vec![]).unwrap_err(),
        ModelError::DanglingNode { .. }
    ));
}

#[test]
fn graph_rejects_disconnected_networks() {
    let err = Graph::new(
        vec![
            src("S1", 0.0, 0.0),
            pass("P1", 0.0, 0.0, 1, 2),
            dest("D1", 0.0, 0.0, 1, 2, 1.0),
            src("S2", 0.0, 0.0),
            pass("P2", 0.0, 0.0, 1, 2),
            dest("D2", 0.0, 0.0, 1, 2, 1.0),
        ],
        edges(&[(0, 1), (1, 2), (3, 4), (4, 5)]),
    )
    .unwrap_err();
    assert_eq!(err, ModelError::Disconnected);
}

#[test]
fn graph_rejects_zero_total_priority() {
    let err = Graph::new(
        vec![src("S", 0.0, 0.0), pass("P", 0.0, 0.0, 1, 2), dest("D", 0.0, 0.0, 1, 2, 0.0)],
        edges(&[(0, 1), (1, 2)]),
    )
    .unwrap_err();
    assert_eq!(err, ModelError::ZeroTotalPriority);
}

#[test]
fn graph_allows_zero_priority_destination_if_total_positive() {
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 0.0, 1, 2),
            dest("D1", 0.0, 0.0, 1, 2, 0.0),
            dest("D2", 0.0, 0.0, 1, 2, 5.0),
        ],
        edges(&[(0, 1), (1, 2), (1, 3)]),
    )
    .unwrap();
    assert_close(g.total_priority(), 5.0);
}

#[test]
fn weak_connectivity_helper() {
    let none: Vec<Vec<NodeIndex>> = vec![vec![]; 3];
    assert!(is_weakly_connected(0, &[], &[]));
    assert!(is_weakly_connected(1, &[vec![]], &[vec![]]));
    assert!(!is_weakly_connected(3, &none, &none));
    // 0 -> 1 <- 2 is weakly connected even though 0 and 2 are not reachable from each other.
    let succs = vec![vec![ix(1)], vec![], vec![ix(1)]];
    let preds = vec![vec![], vec![ix(0), ix(2)], vec![]];
    assert!(is_weakly_connected(3, &preds, &succs));
}

// ---------------------------------------------------------------------------
// UpgradeSet
// ---------------------------------------------------------------------------

#[test]
fn upgrade_set_basic_operations() {
    let mut s = UpgradeSet::new(4);
    assert!(s.is_empty());
    assert_eq!(s.len(), 0);
    assert!(s.insert(ix(2)));
    assert!(!s.insert(ix(2)));
    assert!(s.insert(ix(0)));
    assert!(s.contains(ix(2)));
    assert!(!s.contains(ix(1)));
    assert_eq!(s.len(), 2);
    assert!(!s.is_empty());
    assert_eq!(s.indices(), vec![ix(0), ix(2)]);
    assert!(s.remove(ix(2)));
    assert!(!s.remove(ix(2)));
    assert_eq!(s.indices(), vec![ix(0)]);
    s.clear();
    assert!(s.is_empty());
}

#[test]
fn upgrade_set_out_of_range_is_harmless() {
    let mut s = UpgradeSet::new(2);
    assert!(!s.insert(ix(5)));
    assert!(!s.remove(ix(5)));
    assert!(!s.contains(ix(5)));
    assert!(s.is_empty());
}

#[test]
fn upgrade_set_from_indices() {
    let s = UpgradeSet::from_indices(5, &[ix(1), ix(4), ix(1)]).unwrap();
    assert_eq!(s.indices(), vec![ix(1), ix(4)]);
    assert_eq!(
        UpgradeSet::from_indices(3, &[ix(3)]),
        Err(ModelError::IndexOutOfRange(3))
    );
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

#[test]
fn destination_ttd_hand_computed_zero_transit() {
    let g = zero_transit_chain();
    let route = &g.routes()[0];
    let none = UpgradeSet::new(3);
    // h=0: wait 8 at P (t=8), wait 4 at D (t=12) => 12
    assert_close(destination_time_to_delivery(route, 0.0, &none), 12.0);
    // h=9: P open, wait 3 at D => 3
    assert_close(destination_time_to_delivery(route, 9.0, &none), 3.0);
    // h=11: wait 21 at P (t=32 => 08:00), wait 4 at D (t=36) => 25
    assert_close(destination_time_to_delivery(route, 11.0, &none), 25.0);
    // h=13: P closed -> t=32 -> D 08:00 wait 4 -> 36-13 = 23
    assert_close(destination_time_to_delivery(route, 13.0, &none), 23.0);
    // h=10.5: P is still open (window is [08:00, 11:00)), wait 1.5 at D => 1.5
    assert_close(destination_time_to_delivery(route, 10.5, &none), 1.5);
}

#[test]
fn destination_ttd_with_upgrades() {
    let g = zero_transit_chain();
    let route = &g.routes()[0];
    let up_p = UpgradeSet::from_indices(3, &[ix(1)]).unwrap();
    let up_d = UpgradeSet::from_indices(3, &[ix(2)]).unwrap();
    let up_both = UpgradeSet::from_indices(3, &[ix(1), ix(2)]).unwrap();
    assert_close(destination_time_to_delivery(route, 0.0, &up_p), 12.0);
    assert_close(destination_time_to_delivery(route, 0.0, &up_d), 8.0);
    assert_close(destination_time_to_delivery(route, 0.0, &up_both), 0.0);
}

#[test]
fn upgrading_a_source_has_no_effect() {
    let g = zero_transit_chain();
    let route = &g.routes()[0];
    let up_s = UpgradeSet::from_indices(3, &[ix(0)]).unwrap();
    assert_close(destination_time_to_delivery(route, 0.0, &up_s), 12.0);
}

#[test]
fn destination_ttd_includes_transit_time() {
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 1.0, 0, 23),
            dest("D", 0.0, 2.0, 0, 23, 1.0),
        ],
        edges(&[(0, 1), (1, 2)]),
    )
    .unwrap();
    let hop = coord(0.0, 0.0).travel_hours(coord(0.0, 1.0));
    let ttd = destination_time_to_delivery(&g.routes()[0], 6.0, &UpgradeSet::new(3));
    assert_close(ttd, 2.0 * hop);
    assert!(hop > 1.8 && hop < 1.9);
}

#[test]
fn destination_ttd_transit_can_cause_missing_a_window() {
    // Source->P takes ~1.85 h; P is open [08:00, 11:00). Leaving at 9:30 arrives ~11:21 => waits until 08:00 next day.
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 1.0, 8, 10),
            dest("D", 0.0, 1.0, 0, 23, 1.0),
        ],
        edges(&[(0, 1), (1, 2)]),
    )
    .unwrap();
    let hop = coord(0.0, 0.0).travel_hours(coord(0.0, 1.0));
    let ttd = destination_time_to_delivery(&g.routes()[0], 9.5, &UpgradeSet::new(3));
    assert_close(ttd, (24.0 + 8.0) - 9.5);
    assert!(9.5 + hop > 11.0);
    // Leaving at 9:00 arrives ~10:51, still inside the window.
    let ttd = destination_time_to_delivery(&g.routes()[0], 9.0, &UpgradeSet::new(3));
    assert_close(ttd, hop);
}

#[test]
fn destination_ttd_takes_minimum_over_pass_throughs() {
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("late", 0.0, 0.0, 8, 10),
            pass("early", 0.0, 0.0, 1, 2),
            dest("D", 0.0, 0.0, 0, 23, 1.0),
        ],
        edges(&[(0, 1), (0, 2), (1, 3), (2, 3)]),
    )
    .unwrap();
    let route = &g.routes()[0];
    // h=0: late waits 8, early waits 1 => 1
    assert_close(destination_time_to_delivery(route, 0.0, &UpgradeSet::new(4)), 1.0);
    // h=9: late is open => 0
    assert_close(destination_time_to_delivery(route, 9.0, &UpgradeSet::new(4)), 0.0);
}

#[test]
fn destination_ttd_takes_minimum_over_sources() {
    let g = Graph::new(
        vec![
            src("near", 0.0, 0.5),
            src("far", 0.0, 3.0),
            pass("P", 0.0, 0.0, 0, 23),
            dest("D", 0.0, 0.0, 0, 23, 1.0),
        ],
        edges(&[(0, 2), (1, 2), (2, 3)]),
    )
    .unwrap();
    let expected = coord(0.0, 0.5).travel_hours(coord(0.0, 0.0));
    assert_close(
        destination_time_to_delivery(&g.routes()[0], 0.0, &UpgradeSet::new(4)),
        expected,
    );
}

#[test]
fn destination_ttd_respects_graph_edges() {
    // The close source is NOT connected to P, so the distant one must be used.
    let g = Graph::new(
        vec![
            src("connected_far", 0.0, 3.0),
            src("unconnected_near", 0.0, 0.1),
            pass("P", 0.0, 0.0, 0, 23),
            pass("Q", 0.0, 5.0, 0, 23),
            dest("D", 0.0, 0.0, 0, 23, 1.0),
        ],
        edges(&[(0, 2), (1, 3), (2, 4), (3, 4)]),
    )
    .unwrap();
    let via_p = coord(0.0, 3.0).travel_hours(coord(0.0, 0.0));
    let via_q = coord(0.0, 0.1).travel_hours(coord(0.0, 5.0)) + coord(0.0, 5.0).travel_hours(coord(0.0, 0.0));
    let ttd = destination_time_to_delivery(&g.routes()[0], 0.0, &UpgradeSet::new(5));
    assert_close(ttd, via_p.min(via_q));
    assert_close(ttd, via_p);
}

#[test]
fn average_ttd_averages_over_departures() {
    let g = zero_transit_chain();
    let none = UpgradeSet::new(3);
    let avg = average_time_to_delivery(&g.routes()[0], &hours(&[0.0, 9.0]), &none);
    assert_close(avg, (12.0 + 3.0) / 2.0);
    let single = average_time_to_delivery(&g.routes()[0], &hours(&[11.0]), &none);
    assert_close(single, 25.0);
}

#[test]
fn weighted_ttd_uses_priorities() {
    // D1 (p=3): 12 h, D2 (p=1): 9 h => (3*12 + 9) / 4 = 11.25
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 0.0, 8, 10),
            dest("D1", 0.0, 0.0, 12, 14, 3.0),
            dest("D2", 0.0, 0.0, 9, 10, 1.0),
        ],
        edges(&[(0, 1), (1, 2), (1, 3)]),
    )
    .unwrap();
    let deps = hours(&[0.0]);
    assert_close(weighted_time_to_delivery(&g, &deps, &UpgradeSet::new(4)), 11.25);
    // Upgrade D1 only: D1 -> 8, D2 stays 9 => (24 + 9) / 4 = 8.25
    let up = UpgradeSet::from_indices(4, &[ix(2)]).unwrap();
    assert_close(weighted_time_to_delivery(&g, &deps, &up), 8.25);
}

#[test]
fn weighted_ttd_ignores_zero_priority_destinations() {
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 0.0, 8, 10),
            dest("D1", 0.0, 0.0, 12, 14, 0.0),
            dest("D2", 0.0, 0.0, 9, 10, 2.0),
        ],
        edges(&[(0, 1), (1, 2), (1, 3)]),
    )
    .unwrap();
    assert_close(
        weighted_time_to_delivery(&g, &hours(&[0.0]), &UpgradeSet::new(4)),
        9.0,
    );
}

#[test]
fn weighted_ttd_is_never_increased_by_upgrades() {
    let g = random_graph(11, 3, 4, 4);
    let deps = DepartureTimes::every_hour();
    let base = weighted_time_to_delivery(&g, &deps, &UpgradeSet::new(g.node_count()));
    for c in candidates(&g) {
        let up = UpgradeSet::from_indices(g.node_count(), &[c]).unwrap();
        assert!(weighted_time_to_delivery(&g, &deps, &up) <= base + 1e-9);
    }
}

// ---------------------------------------------------------------------------
// candidates / binomial / next_combination
// ---------------------------------------------------------------------------

#[test]
fn candidates_exclude_sources() {
    let g = zero_transit_chain();
    assert_eq!(candidates(&g), vec![ix(1), ix(2)]);
    let g = random_graph(5, 2, 3, 2);
    let c = candidates(&g);
    assert_eq!(c.len(), 5);
    assert!(c.iter().all(|i| g.node(*i).unwrap().kind() != NodeKind::Source));
}

#[test]
fn binomial_values() {
    assert_eq!(binomial(5, 2), Some(10));
    assert_eq!(binomial(5, 0), Some(1));
    assert_eq!(binomial(5, 5), Some(1));
    assert_eq!(binomial(0, 0), Some(1));
    assert_eq!(binomial(5, 6), Some(0));
    assert_eq!(binomial(52, 5), Some(2_598_960));
    assert_eq!(binomial(60, 30), Some(118_264_581_564_861_424));
}

#[test]
fn binomial_overflow_returns_none() {
    assert_eq!(binomial(200, 100), None);
}

#[test]
fn next_combination_enumerates_in_lexicographic_order() {
    let mut c = vec![0, 1];
    let mut seen = vec![c.clone()];
    while next_combination(&mut c, 4) {
        seen.push(c.clone());
    }
    assert_eq!(
        seen,
        vec![vec![0, 1], vec![0, 2], vec![0, 3], vec![1, 2], vec![1, 3], vec![2, 3]]
    );
}

#[test]
fn next_combination_count_matches_binomial() {
    for (m, k) in [(6usize, 3usize), (7, 1), (7, 7), (8, 4)] {
        let mut c: Vec<usize> = (0..k).collect();
        let mut count = 1u64;
        while next_combination(&mut c, m) {
            count += 1;
        }
        assert_eq!(Some(count), binomial(m as u64, k as u64));
    }
}

#[test]
fn next_combination_edge_cases() {
    assert!(!next_combination(&mut [], 5));
    assert!(!next_combination(&mut [0, 1, 2], 2));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

#[test]
fn exact_search_picks_the_best_single_node() {
    let g = zero_transit_chain();
    let sel = exact_search(&g, &hours(&[0.0]), 1).unwrap();
    assert_eq!(sel.nodes, vec![ix(2)]); // upgrading D: 8 h beats upgrading P: 12 h
    assert_close(sel.objective, 8.0);
}

#[test]
fn exact_search_with_all_candidates_removes_all_waiting() {
    let g = zero_transit_chain();
    let sel = exact_search(&g, &hours(&[0.0, 5.0, 17.0]), 2).unwrap();
    assert_eq!(sel.nodes, vec![ix(1), ix(2)]);
    assert_close(sel.objective, 0.0);
}

#[test]
fn exact_search_matches_independent_brute_force() {
    for seed in 1..=6u64 {
        let g = random_graph(seed, 2, 3, 3);
        let deps = DepartureTimes::every_hour();
        for n in 1..=3usize {
            let sel = exact_search(&g, &deps, n).unwrap();
            assert_eq!(sel.nodes.len(), n);
            assert_close(sel.objective, brute_force_best(&g, &deps, n));
            let recomputed = weighted_time_to_delivery(
                &g,
                &deps,
                &UpgradeSet::from_indices(g.node_count(), &sel.nodes).unwrap(),
            );
            assert_close(sel.objective, recomputed);
        }
    }
}

#[test]
fn exact_search_ties_pick_lexicographically_first() {
    // Everything is already [0,23]: upgrades change nothing, so the first candidates win.
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 0.0, 0, 23),
            dest("D", 0.0, 0.0, 0, 23, 1.0),
        ],
        edges(&[(0, 1), (1, 2)]),
    )
    .unwrap();
    assert_eq!(exact_search(&g, &hours(&[3.0]), 1).unwrap().nodes, vec![ix(1)]);
    assert_eq!(greedy_search(&g, &hours(&[3.0]), 1).unwrap().nodes, vec![ix(1)]);
}

#[test]
fn search_rejects_bad_n() {
    let g = zero_transit_chain();
    let deps = hours(&[0.0]);
    assert_eq!(exact_search(&g, &deps, 0).unwrap_err(), SolveError::ZeroSelection);
    assert_eq!(greedy_search(&g, &deps, 0).unwrap_err(), SolveError::ZeroSelection);
}

#[test]
fn search_with_n_above_candidate_count_selects_every_candidate() {
    let g = zero_transit_chain();
    let deps = hours(&[0.0]);
    for n in [2usize, 3, 100] {
        let exact = exact_search(&g, &deps, n).unwrap();
        let greedy = greedy_search(&g, &deps, n).unwrap();
        assert_eq!(exact.nodes, vec![ix(1), ix(2)]);
        assert_eq!(greedy.nodes, vec![ix(1), ix(2)]);
        assert_close(exact.objective, 0.0);
        assert_close(greedy.objective, 0.0);
    }
}

#[test]
fn greedy_search_basic_scenarios() {
    let g = zero_transit_chain();
    let sel = greedy_search(&g, &hours(&[0.0]), 1).unwrap();
    assert_eq!(sel.nodes, vec![ix(2)]);
    assert_close(sel.objective, 8.0);
    let sel = greedy_search(&g, &hours(&[0.0]), 2).unwrap();
    assert_eq!(sel.nodes, vec![ix(1), ix(2)]);
    assert_close(sel.objective, 0.0);
}

#[test]
fn greedy_search_is_valid_and_close_to_optimal_on_random_graphs() {
    for seed in 1..=8u64 {
        let g = random_graph(seed * 31, 2, 3, 4);
        let deps = DepartureTimes::every_hour();
        let baseline = weighted_time_to_delivery(&g, &deps, &UpgradeSet::new(g.node_count()));
        for n in 1..=3usize {
            let greedy = greedy_search(&g, &deps, n).unwrap();
            let exact = exact_search(&g, &deps, n).unwrap();
            assert_eq!(greedy.nodes.len(), n);
            let unique: HashSet<_> = greedy.nodes.iter().collect();
            assert_eq!(unique.len(), n, "no duplicate picks");
            assert!(greedy.nodes.windows(2).all(|w| w[0] < w[1]), "sorted output");
            assert!(greedy.objective >= exact.objective - 1e-9, "cannot beat the optimum");
            assert!(greedy.objective <= baseline + 1e-9, "cannot be worse than doing nothing");
            let recomputed = weighted_time_to_delivery(
                &g,
                &deps,
                &UpgradeSet::from_indices(g.node_count(), &greedy.nodes).unwrap(),
            );
            assert_close(greedy.objective, recomputed);
        }
    }
}

#[test]
fn solve_auto_uses_exact_when_small() {
    let g = zero_transit_chain();
    let sol = solve(&g, &hours(&[0.0]), 1, Strategy::Auto, &SolverConfig::default()).unwrap();
    assert_eq!(sol.solver, SolverUsed::Exact);
    assert_eq!(sol.selected, vec![ix(2)]);
    assert_close(sol.baseline_objective, 12.0);
    assert_close(sol.optimized_objective, 8.0);
}

#[test]
fn solve_auto_falls_back_to_greedy_above_limit() {
    let g = zero_transit_chain();
    let config = SolverConfig {
        exact_max_combinations: 1,
    };
    let sol = solve(&g, &hours(&[0.0]), 1, Strategy::Auto, &config).unwrap();
    assert_eq!(sol.solver, SolverUsed::Greedy);
    assert_eq!(sol.selected, vec![ix(2)]);
}

#[test]
fn solve_exact_errors_above_limit() {
    let g = zero_transit_chain();
    let config = SolverConfig {
        exact_max_combinations: 1,
    };
    assert_eq!(
        solve(&g, &hours(&[0.0]), 1, Strategy::Exact, &config).unwrap_err(),
        SolveError::ExactTooLarge { limit: 1 }
    );
}

#[test]
fn solve_greedy_ignores_limit() {
    let g = zero_transit_chain();
    let config = SolverConfig {
        exact_max_combinations: 0,
    };
    let sol = solve(&g, &hours(&[0.0]), 2, Strategy::Greedy, &config).unwrap();
    assert_eq!(sol.solver, SolverUsed::Greedy);
    assert_close(sol.optimized_objective, 0.0);
}

#[test]
fn solve_validates_n() {
    let g = zero_transit_chain();
    let cfg = SolverConfig::default();
    assert_eq!(
        solve(&g, &hours(&[0.0]), 0, Strategy::Auto, &cfg).unwrap_err(),
        SolveError::ZeroSelection
    );
    // n larger than the number of upgradable nodes selects all of them, whatever the strategy.
    for strategy in [Strategy::Auto, Strategy::Exact, Strategy::Greedy] {
        let sol = solve(&g, &hours(&[0.0]), 9, strategy, &cfg).unwrap();
        assert_eq!(sol.selected, vec![ix(1), ix(2)]);
        assert_close(sol.optimized_objective, 0.0);
        assert_close(sol.baseline_objective, 12.0);
    }
}

#[test]
fn solver_config_default_limit() {
    assert_eq!(SolverConfig::default().exact_max_combinations, 200_000);
}

#[test]
fn strategy_parsing_and_default() {
    assert_eq!("auto".parse::<Strategy>(), Ok(Strategy::Auto));
    assert_eq!("EXACT".parse::<Strategy>(), Ok(Strategy::Exact));
    assert_eq!("Greedy".parse::<Strategy>(), Ok(Strategy::Greedy));
    assert!("fast".parse::<Strategy>().is_err());
    assert_eq!(Strategy::default(), Strategy::Auto);
}

#[test]
fn strategy_and_solver_serde_names() {
    assert_eq!(serde_json::to_string(&Strategy::Greedy).unwrap(), "\"greedy\"");
    assert_eq!(serde_json::from_str::<Strategy>("\"exact\"").unwrap(), Strategy::Exact);
    assert_eq!(serde_json::to_string(&SolverUsed::Exact).unwrap(), "\"exact\"");
}

// ---------------------------------------------------------------------------
// File parsing
// ---------------------------------------------------------------------------

#[test]
fn parse_valid_file() {
    let input = parse_graph_file(ZERO_CHAIN_JSON.as_bytes()).unwrap();
    assert_eq!(input.graph.node_count(), 3);
    assert_eq!(input.graph.index_of("D"), Some(ix(2)));
    assert_eq!(input.graph.node(ix(1)).unwrap().window(), Some(win(8, 9)));
}

#[test]
fn parse_always_uses_every_whole_hour_as_departure_times() {
    let input = parse_graph_file(ZERO_CHAIN_JSON.as_bytes()).unwrap();
    assert_eq!(input.departures, DepartureTimes::every_hour());
}

#[test]
fn parse_rejects_departure_hours_in_the_file() {
    let with_hours = ZERO_CHAIN_JSON.replace("\"edges\"", "\"departure_hours\": [0], \"edges\"");
    assert!(matches!(
        parse_graph_file(with_hours.as_bytes()),
        Err(InputError::Json(m)) if m.contains("departure_hours")
    ));
}

#[test]
fn parse_rejects_malformed_json() {
    assert!(matches!(parse_graph_file(b"not json"), Err(InputError::Json(_))));
    assert!(matches!(parse_graph_file(b"{}"), Err(InputError::Json(_))));
    assert!(matches!(parse_graph_file(b""), Err(InputError::Json(_))));
}

#[test]
fn parse_rejects_unknown_fields_and_kinds() {
    let extra = ZERO_CHAIN_JSON.replace("\"edges\"", "\"surprise\": 1, \"edges\"");
    assert!(matches!(parse_graph_file(extra.as_bytes()), Err(InputError::Json(_))));
    let kind = ZERO_CHAIN_JSON.replace("\"pass_through\"", "\"teleporter\"");
    assert!(matches!(parse_graph_file(kind.as_bytes()), Err(InputError::Json(_))));
}

#[test]
fn parse_rejects_unknown_edge_endpoints() {
    let bad_from = ZERO_CHAIN_JSON.replace("{\"from\": \"S\"", "{\"from\": \"ghost\"");
    assert_eq!(
        parse_graph_file(bad_from.as_bytes()).unwrap_err(),
        InputError::UnknownNodeId("ghost".into())
    );
    let bad_to = ZERO_CHAIN_JSON.replace("\"to\": \"D\"", "\"to\": \"ghost\"");
    assert_eq!(
        parse_graph_file(bad_to.as_bytes()).unwrap_err(),
        InputError::UnknownNodeId("ghost".into())
    );
}

#[test]
fn parse_surfaces_model_errors() {
    let lat = ZERO_CHAIN_JSON.replacen("\"latitude\": 0", "\"latitude\": 95", 1);
    assert_eq!(
        parse_graph_file(lat.as_bytes()).unwrap_err(),
        InputError::Model(ModelError::InvalidLatitude(95.0))
    );
    let window = ZERO_CHAIN_JSON.replace("\"open_until\": 9", "\"open_until\": 24");
    assert_eq!(
        parse_graph_file(window.as_bytes()).unwrap_err(),
        InputError::Model(ModelError::InvalidWindow { start: 8, end: 24 })
    );
    let prio = ZERO_CHAIN_JSON.replace("\"priority\": 1", "\"priority\": -1");
    assert_eq!(
        parse_graph_file(prio.as_bytes()).unwrap_err(),
        InputError::Model(ModelError::InvalidPriority(-1.0))
    );
    let source_line = "{\"id\": \"S\", \"kind\": \"source\", \"latitude\": 0, \"longitude\": 0},";
    let dup = ZERO_CHAIN_JSON.replace(source_line, &format!("{source_line}{source_line}"));
    assert_eq!(
        parse_graph_file(dup.as_bytes()).unwrap_err(),
        InputError::Model(ModelError::DuplicateId("S".into()))
    );
}

#[test]
fn node_record_into_node_for_each_kind() {
    let s = NodeRecord::Source {
        id: "s".into(),
        latitude: 1.0,
        longitude: 2.0,
    }
    .into_node()
    .unwrap();
    assert_eq!(s, src("s", 1.0, 2.0));

    let p = NodeRecord::PassThrough {
        id: "p".into(),
        latitude: 1.0,
        longitude: 2.0,
        open_from: Some(3),
        open_until: Some(9),
        closed: false,
        solar_open_from: None,
        solar_open_until: None,
    }
    .into_node()
    .unwrap();
    assert_eq!(p, pass("p", 1.0, 2.0, 3, 9));

    let d = NodeRecord::Destination {
        id: "d".into(),
        latitude: 1.0,
        longitude: 2.0,
        open_from: Some(3),
        open_until: Some(9),
        closed: false,
        solar_open_from: None,
        solar_open_until: None,
        priority: 7.0,
    }
    .into_node()
    .unwrap();
    assert_eq!(d, dest("d", 1.0, 2.0, 3, 9, 7.0));

    let bad = NodeRecord::Destination {
        id: "d".into(),
        latitude: 1.0,
        longitude: 200.0,
        open_from: Some(3),
        open_until: Some(9),
        closed: false,
        solar_open_from: None,
        solar_open_until: None,
        priority: 7.0,
    };
    assert_eq!(bad.into_node(), Err(ModelError::InvalidLongitude(200.0)));
}

#[test]
fn graph_file_into_input_matches_parse() {
    let file: GraphFile = serde_json::from_str(ZERO_CHAIN_JSON).unwrap();
    assert_eq!(file.nodes.len(), 3);
    assert_eq!(
        file.edges[0],
        EdgeRecord {
            from: "S".into(),
            to: "P".into()
        }
    );
    let input = file.into_input().unwrap();
    assert_eq!(input.graph.edges().len(), 2);
}

#[test]
fn build_response_maps_indices_to_ids() {
    let g = zero_transit_chain();
    let sol = Solution {
        selected: vec![ix(1), ix(2)],
        baseline_objective: 12.0,
        optimized_objective: 0.0,
        solver: SolverUsed::Exact,
    };
    let r = build_response(&g, &DepartureTimes::every_hour(), 2, &sol);
    assert_eq!(r.selected, vec!["P".to_owned(), "D".to_owned()]);
    assert_eq!(r.n, 2);
    assert_eq!(r.solver, SolverUsed::Exact);
    assert_close(r.baseline_weighted_hours, 12.0);
    assert_close(r.optimized_weighted_hours, 0.0);
}

#[test]
fn analyze_bytes_end_to_end() {
    let r = analyze_bytes(ZERO_CHAIN_JSON.as_bytes(), 1, Strategy::Auto, &SolverConfig::default()).unwrap();
    assert_eq!(r.selected, vec!["P".to_owned()]);
    assert_eq!(r.solver, SolverUsed::Exact);
    assert_close(r.baseline_weighted_hours, 14.5);
    assert_close(r.optimized_weighted_hours, 9.625);
}

#[test]
fn analyze_bytes_with_oversized_n_returns_every_non_source_node() {
    let cfg = SolverConfig::default();
    let r = analyze_bytes(ZERO_CHAIN_JSON.as_bytes(), 50, Strategy::Auto, &cfg).unwrap();
    assert_eq!(r.selected, vec!["P".to_owned(), "D".to_owned()]);
    assert_eq!(r.n, 50);
    assert_close(r.optimized_weighted_hours, 0.0);
}

#[test]
fn analyze_bytes_propagates_errors() {
    let cfg = SolverConfig::default();
    assert!(matches!(
        analyze_bytes(b"xx", 1, Strategy::Auto, &cfg),
        Err(AnalyzeError::Input(InputError::Json(_)))
    ));
    assert_eq!(
        analyze_bytes(ZERO_CHAIN_JSON.as_bytes(), 0, Strategy::Auto, &cfg).unwrap_err(),
        AnalyzeError::Solve(SolveError::ZeroSelection)
    );
}

#[test]
fn error_messages_are_human_readable() {
    assert!(ModelError::InvalidWindow { start: 5, end: 3 }.to_string().contains("[5, 3]"));
    assert!(InputError::UnknownNodeId("x".into()).to_string().contains("`x`"));
    assert!(SolveError::ExactTooLarge { limit: 7 }.to_string().contains("more than 7"));
    assert!(AnalyzeError::from(SolveError::ZeroSelection).to_string().contains("at least 1"));
}

// ---------------------------------------------------------------------------
// ServerSettings
// ---------------------------------------------------------------------------

fn lookup_from<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
    move |name| {
        pairs
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| (*v).to_owned())
    }
}

#[test]
fn settings_defaults() {
    let s = ServerSettings::from_lookup(|_| None).unwrap();
    assert_eq!(s, ServerSettings::default());
    assert_eq!(s.host, IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_eq!(s.port, 8080);
    assert_eq!(s.max_upload_bytes, 10 * 1024 * 1024);
    assert_eq!(s.solver.exact_max_combinations, 200_000);
    assert_eq!(s.socket_addr(), SocketAddr::from(([127, 0, 0, 1], 8080)));
}

#[test]
fn settings_overrides() {
    let pairs = [
        (ENV_HOST, "0.0.0.0"),
        (ENV_PORT, " 9090 "),
        (ENV_MAX_UPLOAD_BYTES, "2048"),
        (ENV_EXACT_MAX_COMBINATIONS, "42"),
    ];
    let s = ServerSettings::from_lookup(lookup_from(&pairs)).unwrap();
    assert_eq!(s.host, IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    assert_eq!(s.port, 9090);
    assert_eq!(s.max_upload_bytes, 2048);
    assert_eq!(s.solver.exact_max_combinations, 42);
    assert_eq!(s.socket_addr(), SocketAddr::from(([0, 0, 0, 0], 9090)));
}

#[test]
fn settings_accept_ipv6() {
    let pairs = [(ENV_HOST, "::1")];
    let s = ServerSettings::from_lookup(lookup_from(&pairs)).unwrap();
    assert!(s.host.is_ipv6());
}

#[test]
fn settings_reject_invalid_values() {
    for (name, value) in [
        (ENV_HOST, "not-an-ip"),
        (ENV_PORT, "70000"),
        (ENV_PORT, "abc"),
        (ENV_MAX_UPLOAD_BYTES, "-5"),
        (ENV_EXACT_MAX_COMBINATIONS, "1.5"),
    ] {
        let pairs = [(name, value)];
        let err = ServerSettings::from_lookup(lookup_from(&pairs)).unwrap_err();
        assert_eq!(err.name, name);
        assert_eq!(err.value, value);
        assert!(err.to_string().contains(name));
    }
}

#[test]
fn settings_from_env_reads_process_environment() {
    // The only test that touches this process's environment.
    std::env::set_var(ENV_MAX_UPLOAD_BYTES, "12345");
    let s = ServerSettings::from_env().unwrap();
    std::env::remove_var(ENV_MAX_UPLOAD_BYTES);
    assert_eq!(s.max_upload_bytes, 12345);
}

// ---------------------------------------------------------------------------
// End-to-end HTTP tests against the real binary
// ---------------------------------------------------------------------------

struct ServerGuard {
    child: Child,
    port: u16,
}

impl Drop for ServerGuard {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn start_server(extra_env: &[(&str, &str)]) -> ServerGuard {
    let port = free_port();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_medroute"));
    cmd.env_remove(ENV_HOST)
        .env_remove(ENV_MAX_UPLOAD_BYTES)
        .env_remove(ENV_EXACT_MAX_COMBINATIONS)
        .env(ENV_HOST, "127.0.0.1")
        .env(ENV_PORT, port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let child = cmd.spawn().expect("failed to start server binary");
    let guard = ServerGuard { child, port };
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return guard;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("server did not start listening on port {port}");
}

struct HttpResponse {
    status: u16,
    body: String,
}

impl HttpResponse {
    fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).unwrap_or_else(|e| panic!("bad JSON `{}`: {e}", self.body))
    }
}

fn http(port: u16, method: &str, target: &str, content_type: Option<&str>, body: &[u8]) -> HttpResponse {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    let mut head = format!("{method} {target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n");
    if let Some(ct) = content_type {
        head.push_str(&format!("Content-Type: {ct}\r\n"));
    }
    head.push_str(&format!("Content-Length: {}\r\n\r\n", body.len()));
    // The server may close early (e.g. body too large); ignore write errors and read what it said.
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw).into_owned();
    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| panic!("no status line in `{text}`"));
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_owned()).unwrap_or_default();
    HttpResponse { status, body }
}

const BOUNDARY: &str = "----medroute-test-boundary";

fn multipart(part_name: &str, content: &str) -> Vec<u8> {
    format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{part_name}\"; filename=\"graph.json\"\r\nContent-Type: application/json\r\n\r\n{content}\r\n--{BOUNDARY}--\r\n"
    )
    .into_bytes()
}

fn analyze(server: &ServerGuard, query: &str, content: &str) -> HttpResponse {
    http(
        server.port,
        "POST",
        &format!("/api/analyze{query}"),
        Some(&format!("multipart/form-data; boundary={BOUNDARY}")),
        &multipart("file", content),
    )
}

#[test]
fn http_health() {
    let s = start_server(&[]);
    let r = http(s.port, "GET", "/health", None, b"");
    assert_eq!(r.status, 200);
    assert_eq!(r.body, "ok");
}

#[test]
fn http_analyze_success_with_default_strategy() {
    let s = start_server(&[]);
    let r = analyze(&s, "?n=1", ZERO_CHAIN_JSON);
    assert_eq!(r.status, 200, "{}", r.body);
    let v = r.json();
    assert_eq!(v["selected"], serde_json::json!(["P"]));
    assert_eq!(v["n"], 1);
    assert_eq!(v["solver"], "exact");
    assert!((v["baseline_weighted_hours"].as_f64().unwrap() - 14.5).abs() < 1e-9);
    assert!((v["optimized_weighted_hours"].as_f64().unwrap() - 9.625).abs() < 1e-9);
}

#[test]
fn http_analyze_two_nodes_and_explicit_strategies() {
    let s = start_server(&[]);
    for (strategy, solver) in [("exact", "exact"), ("greedy", "greedy"), ("auto", "exact")] {
        let r = analyze(&s, &format!("?n=2&strategy={strategy}"), ZERO_CHAIN_JSON);
        assert_eq!(r.status, 200, "{}", r.body);
        let v = r.json();
        assert_eq!(v["selected"], serde_json::json!(["P", "D"]));
        assert_eq!(v["solver"], solver);
        assert!(v["optimized_weighted_hours"].as_f64().unwrap().abs() < 1e-9);
    }
}

#[test]
fn http_analyze_accepts_file_part_after_other_parts() {
    let s = start_server(&[]);
    let body = format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nhello\r\n--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"g.json\"\r\nContent-Type: application/json\r\n\r\n{ZERO_CHAIN_JSON}\r\n--{BOUNDARY}--\r\n"
    );
    let r = http(
        s.port,
        "POST",
        "/api/analyze?n=1",
        Some(&format!("multipart/form-data; boundary={BOUNDARY}")),
        body.as_bytes(),
    );
    assert_eq!(r.status, 200, "{}", r.body);
}

#[test]
fn http_analyze_missing_file_part_is_400() {
    let s = start_server(&[]);
    let r = http(
        s.port,
        "POST",
        "/api/analyze?n=1",
        Some(&format!("multipart/form-data; boundary={BOUNDARY}")),
        &multipart("wrong_name", ZERO_CHAIN_JSON),
    );
    assert_eq!(r.status, 400);
    assert!(r.json()["error"].as_str().unwrap().contains("file"));
}

#[test]
fn http_analyze_non_multipart_body_is_rejected() {
    let s = start_server(&[]);
    let r = http(
        s.port,
        "POST",
        "/api/analyze?n=1",
        Some("application/json"),
        ZERO_CHAIN_JSON.as_bytes(),
    );
    assert!(r.status == 400 || r.status == 415, "got {}", r.status);
}

#[test]
fn http_analyze_malformed_json_is_400() {
    let s = start_server(&[]);
    let r = analyze(&s, "?n=1", "{ definitely not json");
    assert_eq!(r.status, 400);
    assert!(r.json()["error"].as_str().unwrap().contains("malformed"));
}

#[test]
fn http_analyze_invalid_graph_is_422() {
    let s = start_server(&[]);
    let bad = ZERO_CHAIN_JSON.replace("{\"from\": \"P\", \"to\": \"D\"}", "{\"from\": \"S\", \"to\": \"D\"}");
    let r = analyze(&s, "?n=1", &bad);
    assert_eq!(r.status, 422);
    assert!(r.json()["error"].as_str().unwrap().contains("invalid"));
}

#[test]
fn http_analyze_unknown_edge_id_is_422() {
    let s = start_server(&[]);
    let bad = ZERO_CHAIN_JSON.replace("\"to\": \"D\"", "\"to\": \"nowhere\"");
    let r = analyze(&s, "?n=1", &bad);
    assert_eq!(r.status, 422);
    assert!(r.json()["error"].as_str().unwrap().contains("nowhere"));
}

#[test]
fn http_analyze_bad_n_values() {
    let s = start_server(&[]);
    assert_eq!(analyze(&s, "?n=0", ZERO_CHAIN_JSON).status, 422);
    assert_eq!(analyze(&s, "", ZERO_CHAIN_JSON).status, 400);
    assert_eq!(analyze(&s, "?n=-1", ZERO_CHAIN_JSON).status, 400);
    assert_eq!(analyze(&s, "?n=abc", ZERO_CHAIN_JSON).status, 400);
}

#[test]
fn http_analyze_n_above_candidate_count_returns_all_non_sources() {
    let s = start_server(&[]);
    for strategy in ["auto", "exact", "greedy"] {
        let r = analyze(&s, &format!("?n=3&strategy={strategy}"), ZERO_CHAIN_JSON);
        assert_eq!(r.status, 200, "{}", r.body);
        let v = r.json();
        assert_eq!(v["selected"], serde_json::json!(["P", "D"]));
        assert_eq!(v["n"], 3);
    }
}

#[test]
fn http_analyze_rejects_departure_hours_in_file() {
    let s = start_server(&[]);
    let bad = ZERO_CHAIN_JSON.replace("\"edges\"", "\"departure_hours\": [0], \"edges\"");
    let r = analyze(&s, "?n=1", &bad);
    assert_eq!(r.status, 400);
}

#[test]
fn http_analyze_bad_strategy_is_400() {
    let s = start_server(&[]);
    assert_eq!(analyze(&s, "?n=1&strategy=quantum", ZERO_CHAIN_JSON).status, 400);
}

#[test]
fn http_routing_errors() {
    let s = start_server(&[]);
    assert_eq!(http(s.port, "GET", "/nope", None, b"").status, 404);
    assert_eq!(http(s.port, "GET", "/api/analyze?n=1", None, b"").status, 405);
}

#[test]
fn http_env_exact_limit_is_honoured_without_recompiling() {
    let s = start_server(&[(ENV_EXACT_MAX_COMBINATIONS, "0")]);
    let r = analyze(&s, "?n=1&strategy=exact", ZERO_CHAIN_JSON);
    assert_eq!(r.status, 422);
    assert!(r.json()["error"].as_str().unwrap().contains("exact search"));
    let r = analyze(&s, "?n=1", ZERO_CHAIN_JSON);
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.json()["solver"], "greedy");
}

#[test]
fn http_env_max_upload_is_honoured() {
    let s = start_server(&[(ENV_MAX_UPLOAD_BYTES, "200")]);
    let r = analyze(&s, "?n=1", ZERO_CHAIN_JSON);
    assert_eq!(r.status, 413);
}

#[test]
fn server_refuses_to_start_with_invalid_environment() {
    let status = Command::new(env!("CARGO_BIN_EXE_medroute"))
        .env(ENV_PORT, "not-a-port")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(!status.success());
}

#[test]
fn server_fails_cleanly_when_port_is_taken() {
    let taken = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let status = Command::new(env!("CARGO_BIN_EXE_medroute"))
        .env(ENV_HOST, "127.0.0.1")
        .env(ENV_PORT, port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(!status.success());
}

// ---------------------------------------------------------------------------
// Solar windows (a site that is only staffed part of the day)
// ---------------------------------------------------------------------------

/// ZERO_CHAIN_JSON with explicit solar windows on P and D.
fn chain_with_solar(p: (i64, i64), d: (i64, i64)) -> String {
    ZERO_CHAIN_JSON
        .replace(
            "\"open_until\": 9}",
            &format!(
                "\"open_until\": 9, \"solar_open_from\": {}, \"solar_open_until\": {}}}",
                p.0, p.1
            ),
        )
        .replace(
            "\"open_until\": 14,",
            &format!(
                "\"open_until\": 14, \"solar_open_from\": {}, \"solar_open_until\": {},",
                d.0, d.1
            ),
        )
}

#[test]
fn solar_window_defaults_to_always_open() {
    let input = parse_graph_file(ZERO_CHAIN_JSON.as_bytes()).unwrap();
    assert_eq!(
        input.graph.node(ix(1)).unwrap().solar_window(),
        Some(TimeWindow::ALWAYS_OPEN)
    );
    assert_eq!(
        input.graph.node(ix(2)).unwrap().solar_window(),
        Some(TimeWindow::ALWAYS_OPEN)
    );
    assert_eq!(input.graph.node(ix(0)).unwrap().solar_window(), None);
}

#[test]
fn solar_window_is_parsed() {
    let input = parse_graph_file(chain_with_solar((6, 17), (8, 20)).as_bytes()).unwrap();
    assert_eq!(
        input.graph.node(ix(1)).unwrap().solar_window(),
        Some(win(6, 17))
    );
    assert_eq!(
        input.graph.node(ix(2)).unwrap().solar_window(),
        Some(win(8, 20))
    );
}

#[test]
fn solar_window_must_contain_the_opening_window() {
    assert_eq!(
        parse_graph_file(chain_with_solar((9, 17), (0, 23)).as_bytes()).unwrap_err(),
        InputError::Model(ModelError::SolarWindowTooNarrow {
            start: 8,
            end: 9,
            solar_start: 9,
            solar_end: 17
        })
    );
    let only_from = ZERO_CHAIN_JSON.replace(
        "\"open_until\": 9}",
        "\"open_until\": 9, \"solar_open_from\": 0}",
    );
    assert!(matches!(
        parse_graph_file(only_from.as_bytes()).unwrap_err(),
        InputError::Model(ModelError::InvalidWindow { .. })
    ));
}

#[test]
fn upgrading_switches_to_the_solar_window_not_always_open() {
    // Solar windows equal to the opening windows: solar power changes nothing.
    let same = parse_graph_file(chain_with_solar((8, 9), (12, 14)).as_bytes()).unwrap();
    let both = UpgradeSet::from_indices(3, &[ix(1), ix(2)]).unwrap();
    let none = UpgradeSet::new(3);
    let objective = |input: &ParsedInput, set: &UpgradeSet| {
        weighted_time_to_delivery(&input.graph, &input.departures, set)
    };
    assert_close(objective(&same, &none), 14.5);
    assert_close(objective(&same, &both), 14.5);

    // Default (24/7) solar windows: upgrading both removes every wait.
    let open = parse_graph_file(ZERO_CHAIN_JSON.as_bytes()).unwrap();
    assert_close(objective(&open, &both), 0.0);
}

#[test]
fn solver_skips_sites_whose_solar_window_adds_nothing() {
    // Without solar windows P is the best single upgrade (see ZERO_CHAIN_JSON notes).
    // If P is staffed only during its current hours, solar can't help it, so D wins.
    let input = parse_graph_file(chain_with_solar((8, 9), (0, 23)).as_bytes()).unwrap();
    let solution = solve(
        &input.graph,
        &input.departures,
        1,
        Strategy::Auto,
        &SolverConfig::default(),
    )
    .unwrap();
    assert_eq!(solution.selected, vec![ix(2)]);
}

// ---------------------------------------------------------------------------
// Closed sites (never open without solar power, e.g. never staffed while the
// grid is on): still part of the network, counted as a full day's wait.
// ---------------------------------------------------------------------------

/// ZERO_CHAIN_JSON with D closed without solar power.
fn chain_with_closed_destination() -> String {
    ZERO_CHAIN_JSON.replace(
        "\"open_from\": 12, \"open_until\": 14,",
        "\"closed\": true,",
    )
}

#[test]
fn closed_window_always_waits_a_full_day() {
    let closed = TimeWindow::CLOSED;
    assert!(closed.is_closed());
    assert!(!closed.is_always_open());
    assert!(!win(0, 23).is_closed());
    for t in [0.0, 7.5, 12.0, 23.99, 40.0, -3.0] {
        assert_close(closed.wait_hours(t), CLOSED_WAIT_HOURS);
    }
    // Longer than the longest wait any open window can cause.
    assert!(CLOSED_WAIT_HOURS > win(8, 8).wait_hours(9.0));
}

#[test]
fn closed_window_containment() {
    // Any solar window "contains" a closed opening window; nothing open fits in a closed one.
    assert!(win(9, 16).contains(TimeWindow::CLOSED));
    assert!(TimeWindow::ALWAYS_OPEN.contains(TimeWindow::CLOSED));
    assert!(TimeWindow::CLOSED.contains(TimeWindow::CLOSED));
    assert!(!TimeWindow::CLOSED.contains(win(9, 16)));
}

#[test]
fn closed_node_is_parsed_with_its_solar_window() {
    let json = chain_with_closed_destination().replace(
        "\"closed\": true,",
        "\"closed\": true, \"solar_open_from\": 9, \"solar_open_until\": 16,",
    );
    let input = parse_graph_file(json.as_bytes()).unwrap();
    let d = input.graph.node(ix(2)).unwrap();
    assert_eq!(d.window(), Some(TimeWindow::CLOSED));
    assert_eq!(d.solar_window(), Some(win(9, 16)));
}

#[test]
fn closed_node_cannot_also_have_opening_hours() {
    let json = ZERO_CHAIN_JSON.replace(
        "\"open_from\": 12, \"open_until\": 14,",
        "\"open_from\": 12, \"open_until\": 14, \"closed\": true,",
    );
    assert_eq!(
        parse_graph_file(json.as_bytes()).unwrap_err(),
        InputError::Model(ModelError::ClosedWithWindow)
    );
}

#[test]
fn open_node_still_needs_both_opening_hours() {
    let neither = ZERO_CHAIN_JSON.replace("\"open_from\": 12, \"open_until\": 14,", "");
    assert_eq!(
        parse_graph_file(neither.as_bytes()).unwrap_err(),
        InputError::Model(ModelError::InvalidWindow { start: -1, end: -1 })
    );
    let only_from = ZERO_CHAIN_JSON.replace("\"open_until\": 14,", "");
    assert_eq!(
        parse_graph_file(only_from.as_bytes()).unwrap_err(),
        InputError::Model(ModelError::InvalidWindow { start: 12, end: -1 })
    );
}

#[test]
fn closed_destination_counts_a_full_day_and_solar_opens_it() {
    // P open [8,10) (average wait 253/24, see ZERO_CHAIN_JSON notes), D closed.
    let input = parse_graph_file(chain_with_closed_destination().as_bytes()).unwrap();
    let objective = |indices: &[NodeIndex]| {
        let set = UpgradeSet::from_indices(3, indices).unwrap();
        weighted_time_to_delivery(&input.graph, &input.departures, &set)
    };
    assert_close(objective(&[]), 253.0 / 24.0 + CLOSED_WAIT_HOURS);
    assert_close(objective(&[ix(1)]), CLOSED_WAIT_HOURS); // P always open, D still closed
    assert_close(objective(&[ix(2)]), 253.0 / 24.0); // D opened 24/7 by solar
    assert_close(objective(&[ix(1), ix(2)]), 0.0);
}

#[test]
fn solver_puts_solar_on_the_closed_site_first() {
    // With D open, P is the best single upgrade; once D is closed, opening it matters most.
    let input = parse_graph_file(chain_with_closed_destination().as_bytes()).unwrap();
    let solution = solve(
        &input.graph,
        &input.departures,
        1,
        Strategy::Auto,
        &SolverConfig::default(),
    )
    .unwrap();
    assert_eq!(solution.selected, vec![ix(2)]);
    assert_close(solution.baseline_objective, 253.0 / 24.0 + CLOSED_WAIT_HOURS);
    assert_close(solution.optimized_objective, 253.0 / 24.0);
}

#[test]
fn closed_warehouse_is_also_modelled() {
    let json = ZERO_CHAIN_JSON.replace("\"open_from\": 8, \"open_until\": 9", "\"closed\": true");
    let input = parse_graph_file(json.as_bytes()).unwrap();
    assert_eq!(input.graph.node(ix(1)).unwrap().window(), Some(TimeWindow::CLOSED));
    let solution = solve(
        &input.graph,
        &input.departures,
        1,
        Strategy::Auto,
        &SolverConfig::default(),
    )
    .unwrap();
    assert_eq!(solution.selected, vec![ix(1)]);
}

// ---------------------------------------------------------------------------
// Breakdowns (travel vs waiting), per-destination reports, and the
// priority-first comparison
// ---------------------------------------------------------------------------

#[test]
fn breakdown_splits_the_average_into_travel_and_waiting() {
    // D is 1 degree of longitude east of P on the equator: about 1.853 h at 60 km/h.
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 0.0, 8, 10),
            dest("D", 0.0, 1.0, 12, 14, 1.0),
        ],
        edges(&[(0, 1), (1, 2)]),
    )
    .unwrap();
    let travel = coord(0.0, 0.0).travel_hours(coord(0.0, 1.0));
    let departures = DepartureTimes::every_hour();
    for set in [UpgradeSet::new(3), UpgradeSet::from_indices(3, &[ix(1), ix(2)]).unwrap()] {
        let b = average_delivery_breakdown(&g.routes()[0], &departures, &set);
        assert_close(b.total_hours, average_time_to_delivery(&g.routes()[0], &departures, &set));
        assert_close(b.travel_hours, travel); // solar never changes the drive
        assert_close(b.waiting_hours, b.total_hours - travel);
    }
    // Both open 24/7: nothing to wait for.
    let both = UpgradeSet::from_indices(3, &[ix(1), ix(2)]).unwrap();
    assert_close(average_delivery_breakdown(&g.routes()[0], &departures, &both).waiting_hours, 0.0);
}

#[test]
fn weighted_breakdown_matches_the_objective_on_random_networks() {
    let departures = DepartureTimes::every_hour();
    for seed in 1..=12 {
        let g = random_graph(seed, 2, 3, 4);
        let candidates = candidates(&g);
        let set = UpgradeSet::from_indices(g.node_count(), &candidates[..2]).unwrap();
        for upgrades in [UpgradeSet::new(g.node_count()), set] {
            let b = weighted_delivery_breakdown(&g, &departures, &upgrades);
            assert_close(b.total_hours, weighted_time_to_delivery(&g, &departures, &upgrades));
            assert_close(b.travel_hours + b.waiting_hours, b.total_hours);
            assert!(b.waiting_hours >= 0.0 && b.travel_hours >= 0.0);
        }
    }
}

#[test]
fn priority_first_takes_the_highest_priority_destinations() {
    let g = Graph::new(
        vec![
            src("S", 0.0, 0.0),
            pass("P", 0.0, 0.0, 8, 10),
            dest("small", 0.0, 0.0, 12, 14, 5.0),
            dest("big", 0.0, 0.0, 12, 14, 50.0),
            dest("tie-a", 0.0, 0.0, 12, 14, 20.0),
            dest("tie-b", 0.0, 0.0, 12, 14, 20.0),
        ],
        edges(&[(0, 1), (1, 2), (1, 3), (1, 4), (1, 5)]),
    )
    .unwrap();
    assert_eq!(priority_first(&g, 1), vec![ix(3)]);
    // Ties go to the earlier node; the result is in node order.
    assert_eq!(priority_first(&g, 2), vec![ix(3), ix(4)]);
    // Never more than there are destinations, and never a pass-through.
    assert_eq!(priority_first(&g, 10), vec![ix(2), ix(3), ix(4), ix(5)]);
}

#[test]
fn analyze_bytes_reports_breakdowns_destinations_and_the_comparison() {
    let r = analyze_bytes(ZERO_CHAIN_JSON.as_bytes(), 1, Strategy::Auto, &SolverConfig::default()).unwrap();
    // Zero transit: all of it is waiting.
    assert_close(r.baseline_breakdown.total_hours, 14.5);
    assert_close(r.baseline_breakdown.travel_hours, 0.0);
    assert_close(r.baseline_breakdown.waiting_hours, 14.5);
    assert_close(r.optimized_breakdown.total_hours, r.optimized_weighted_hours);
    assert_eq!(r.destinations.len(), 1);
    assert_eq!(r.destinations[0].id, "D");
    assert_close(r.destinations[0].priority, 1.0);
    assert_close(r.destinations[0].baseline.total_hours, 14.5);
    assert_close(r.destinations[0].optimized.total_hours, 9.625);
    // The obvious plan, solar on the one clinic (D), is worse than Convoy's (P).
    assert_eq!(r.priority_first.selected, vec!["D".to_owned()]);
    assert_close(r.priority_first.weighted_hours, 253.0 / 24.0);
    assert!(r.priority_first.weighted_hours > r.optimized_weighted_hours);
}

#[test]
fn analyze_response_json_has_the_new_fields() {
    let r = analyze_bytes(ZERO_CHAIN_JSON.as_bytes(), 1, Strategy::Auto, &SolverConfig::default()).unwrap();
    let v = serde_json::to_value(&r).unwrap();
    for key in ["baseline_breakdown", "optimized_breakdown", "destinations", "priority_first"] {
        assert!(v.get(key).is_some(), "missing {key}");
    }
    assert!(v["baseline_breakdown"]["waiting_hours"].is_number());
    assert_eq!(v["destinations"][0]["id"], "D");
    assert_eq!(v["priority_first"]["selected"], serde_json::json!(["D"]));
}
