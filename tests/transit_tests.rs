use transit::*;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const EPS: f64 = 1e-9;

fn approx(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6, "expected {b}, got {a}");
}

fn iv(a: u8, b: u8) -> TimeInterval {
    TimeInterval::new(a, b).unwrap()
}

fn meta(parents: &[usize], a: u8, b: u8, x: f64, y: f64) -> NodeMetadata {
    NodeMetadata {
        parents: NodeList(parents.iter().map(|&p| NodeId(p)).collect()),
        interval: iv(a, b),
        coordinates: Coordinates(x, y),
    }
}

/// Spec: (id, parents, open_start, open_end, x, y). Parents must precede children.
fn build(spec: &[(usize, &[usize], u8, u8, f64, f64)]) -> TransitGraph {
    let mut g = TransitGraph::new();
    for &(id, parents, a, b, x, y) in spec {
        g.add_node(NodeId(id), meta(parents, a, b, x, y)).unwrap();
    }
    g
}

fn svc() -> GraphService {
    GraphService::default()
}

fn tt(g: &TransitGraph, s: usize, t: usize, start: f64) -> Option<f64> {
    svc().calculate_transit_time(g, NodeId(s), NodeId(t), start)
}

/// Two nodes 60 km apart (1 hour), 0 -> 1.
fn two_nodes(a0: (u8, u8), a1: (u8, u8)) -> TransitGraph {
    build(&[
        (0, &[], a0.0, a0.1, 0.0, 0.0),
        (1, &[0], a1.0, a1.1, 60.0, 0.0),
    ])
}

/// Chain 0 -> 1 -> 2 with each hop 30 km (0.5 h).
fn chain(open1: (u8, u8)) -> TransitGraph {
    build(&[
        (0, &[], 0, 24, 0.0, 0.0),
        (1, &[0], open1.0, open1.1, 30.0, 0.0),
        (2, &[1], 0, 24, 60.0, 0.0),
    ])
}

/// Number of reachable (hour, ordered pair) samples, via the public API.
fn reachable_samples(g: &TransitGraph) -> usize {
    let ids = g.all_nodes().0;
    let mut n = 0;
    for h in 9..=17 {
        for &s in &ids {
            for &t in &ids {
                if s != t && svc().calculate_transit_time(g, s, t, h as f64).is_some() {
                    n += 1;
                }
            }
        }
    }
    n
}

/// Tiny deterministic PRNG so tests need no external crates.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo)
    }
}

fn random_graph(seed: u64, n: usize) -> TransitGraph {
    let mut rng = Rng(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1);
    let mut g = TransitGraph::new();
    for i in 0..n {
        let mut parents = Vec::new();
        for p in 0..i {
            if rng.range(0, 100) < 35 {
                parents.push(p);
            }
        }
        let a = rng.range(0, 14) as u8;
        let b = (a as u64 + rng.range(1, 24 - a as u64 + 1)).min(24) as u8;
        let x = rng.range(0, 120) as f64;
        let y = rng.range(0, 120) as f64;
        g.add_node(NodeId(i), meta(&parents, a, b, x, y)).unwrap();
    }
    g
}

/// Independent reference: Bellman-Ford style relaxation of the same edge rule.
fn reference_arrivals(g: &TransitGraph, source: NodeId, start: f64) -> Vec<(NodeId, f64)> {
    let ids = g.all_nodes().0;
    let mut best: std::collections::HashMap<usize, f64> = std::collections::HashMap::new();
    best.insert(source.0, start);
    loop {
        let mut changed = false;
        for &v in &ids {
            let mv = g.get_node(&v).unwrap();
            for &u in &mv.parents.0 {
                let Some(&cur) = best.get(&u.0) else { continue };
                let mu = g.get_node(&u).unwrap();
                let travel = mu.coordinates.distance_to(&mv.coordinates) / 60.0;
                let depart = cur
                    .max(mu.interval.start() as f64)
                    .max(mv.interval.start() as f64 - travel);
                let latest = (mu.interval.end() as f64).min(mv.interval.end() as f64 - travel);
                if depart < latest {
                    let arr = depart + travel;
                    if best.get(&v.0).map_or(true, |&b| arr < b - 1e-12) {
                        best.insert(v.0, arr);
                        changed = true;
                    }
                }
            }
        }
        if !changed {
            break;
        }
    }
    let mut out: Vec<_> = best.into_iter().map(|(k, v)| (NodeId(k), v)).collect();
    out.sort_by_key(|(k, _)| k.0);
    out
}

// ------------------------------------------------------------------
// Coordinates
// ------------------------------------------------------------------

#[test]
fn distance_pythagorean_triple() {
    approx(Coordinates(0.0, 0.0).distance_to(&Coordinates(3.0, 4.0)), 5.0);
}

#[test]
fn distance_zero_and_symmetric() {
    let a = Coordinates(1.5, -2.0);
    let b = Coordinates(-4.0, 7.25);
    approx(a.distance_to(&a), 0.0);
    approx(a.distance_to(&b), b.distance_to(&a));
}

// ------------------------------------------------------------------
// TimeInterval
// ------------------------------------------------------------------

#[test]
fn interval_accepts_valid() {
    assert!(TimeInterval::new(0, 24).is_ok());
    assert!(TimeInterval::new(9, 17).is_ok());
    assert!(TimeInterval::new(23, 24).is_ok());
    let i = iv(9, 17);
    assert_eq!((i.start(), i.end()), (9, 17));
}

#[test]
fn interval_rejects_invalid() {
    assert!(TimeInterval::new(5, 5).is_err());
    assert!(TimeInterval::new(10, 9).is_err());
    assert!(TimeInterval::new(0, 25).is_err());
    assert!(TimeInterval::new(24, 24).is_err());
}

#[test]
fn interval_is_half_open() {
    let i = iv(9, 17);
    assert!(i.is_open_at(9.0)); // inclusive start
    assert!(i.is_open_at(12.5));
    assert!(i.is_open_at(16.999));
    assert!(!i.is_open_at(17.0)); // exclusive end
    assert!(!i.is_open_at(8.999));
    assert!(!i.is_open_at(20.0));
}

// ------------------------------------------------------------------
// Graph structure
// ------------------------------------------------------------------

#[test]
fn graph_add_and_get_nodes() {
    let g = build(&[(0, &[], 0, 24, 0.0, 0.0), (1, &[0], 9, 17, 1.0, 1.0)]);
    assert_eq!(g.len(), 2);
    assert!(g.get_node(&NodeId(1)).is_some());
    assert!(g.get_node(&NodeId(7)).is_none());
    assert!(g.has_edge(NodeId(0), NodeId(1)));
    assert!(!g.has_edge(NodeId(1), NodeId(0)));
}

#[test]
fn graph_all_nodes_sorted() {
    let g = build(&[
        (5, &[], 0, 24, 0.0, 0.0),
        (2, &[5], 0, 24, 0.0, 0.0),
        (9, &[], 0, 24, 0.0, 0.0),
    ]);
    let ids: Vec<usize> = g.all_nodes().0.iter().map(|n| n.0).collect();
    assert_eq!(ids, vec![2, 5, 9]);
}

#[test]
fn graph_rejects_bad_nodes() {
    let mut g = build(&[(0, &[], 0, 24, 0.0, 0.0)]);
    assert!(g.add_node(NodeId(1), meta(&[42], 0, 24, 0.0, 0.0)).is_err()); // missing parent
    assert!(g.add_node(NodeId(1), meta(&[1], 0, 24, 0.0, 0.0)).is_err()); // self parent
    assert!(g.add_node(NodeId(1), meta(&[], 0, 24, f64::NAN, 0.0)).is_err());
    assert_eq!(g.len(), 1);
}

#[test]
fn graph_dedupes_parents() {
    let mut g = build(&[(0, &[], 0, 24, 0.0, 0.0)]);
    g.add_node(NodeId(1), meta(&[0, 0], 0, 24, 1.0, 0.0)).unwrap();
    assert_eq!(g.get_node(&NodeId(1)).unwrap().parents.0.len(), 1);
}

#[test]
fn graph_replacing_node_cannot_create_cycle_and_rolls_back() {
    let mut g = build(&[
        (0, &[], 0, 24, 0.0, 0.0),
        (1, &[0], 0, 24, 1.0, 0.0),
        (2, &[1], 0, 24, 2.0, 0.0),
    ]);
    // Make 0 a child of 2 => 0 -> 1 -> 2 -> 0 cycle.
    assert!(g.add_node(NodeId(0), meta(&[2], 0, 24, 0.0, 0.0)).is_err());
    assert!(g.get_node(&NodeId(0)).unwrap().parents.0.is_empty()); // unchanged
}

#[test]
fn graph_has_path() {
    let g = chain((0, 24));
    assert!(g.has_path(NodeId(0), NodeId(2)));
    assert!(!g.has_path(NodeId(2), NodeId(0)));
    assert!(g.has_path(NodeId(1), NodeId(1)));
}

#[test]
fn apply_update_hours() {
    let mut g = chain((0, 24));
    g.apply_change(&GraphChange::UpdateHours(NodeId(1), iv(10, 12))).unwrap();
    assert_eq!(g.get_node(&NodeId(1)).unwrap().interval, iv(10, 12));
    assert!(g.apply_change(&GraphChange::UpdateHours(NodeId(9), iv(1, 2))).is_err());
}

#[test]
fn apply_add_and_remove_edge() {
    let mut g = chain((0, 24));
    let add = GraphChange::AddEdge { parent: NodeId(0), child: NodeId(2) };
    g.apply_change(&add).unwrap();
    assert!(g.has_edge(NodeId(0), NodeId(2)));
    assert!(g.apply_change(&add).is_err()); // duplicate
    let rem = GraphChange::RemoveEdge { parent: NodeId(0), child: NodeId(2) };
    g.apply_change(&rem).unwrap();
    assert!(!g.has_edge(NodeId(0), NodeId(2)));
    assert!(g.apply_change(&rem).is_err()); // already gone
}

#[test]
fn apply_add_edge_rejects_cycles_loops_unknowns() {
    let mut g = chain((0, 24));
    assert!(g
        .apply_change(&GraphChange::AddEdge { parent: NodeId(2), child: NodeId(0) })
        .is_err());
    assert!(g
        .apply_change(&GraphChange::AddEdge { parent: NodeId(1), child: NodeId(1) })
        .is_err());
    assert!(g
        .apply_change(&GraphChange::AddEdge { parent: NodeId(0), child: NodeId(99) })
        .is_err());
}

// ------------------------------------------------------------------
// calculate_transit_time
// ------------------------------------------------------------------

#[test]
fn transit_same_node_is_zero() {
    let g = two_nodes((0, 24), (0, 24));
    approx(tt(&g, 0, 0, 9.0).unwrap(), 0.0);
}

#[test]
fn transit_unknown_nodes_and_bad_start() {
    let g = two_nodes((0, 24), (0, 24));
    assert!(tt(&g, 0, 99, 9.0).is_none());
    assert!(tt(&g, 99, 0, 9.0).is_none());
    assert!(tt(&g, 99, 99, 9.0).is_none());
    assert!(tt(&g, 0, 1, f64::NAN).is_none());
    assert!(tt(&g, 0, 1, f64::INFINITY).is_none());
}

#[test]
fn transit_direct_edge_takes_distance_over_speed() {
    let g = two_nodes((0, 24), (0, 24));
    approx(tt(&g, 0, 1, 9.0).unwrap(), 1.0); // 60 km at 60 kph
    approx(tt(&g, 0, 1, 9.5).unwrap(), 1.0); // fractional start
}

#[test]
fn transit_edges_are_directed() {
    let g = two_nodes((0, 24), (0, 24));
    assert!(tt(&g, 1, 0, 9.0).is_none());
}

#[test]
fn transit_waits_for_target_to_open() {
    // Target opens at 11; leave at 10 (after waiting 1h at source), arrive 11 => 2h.
    let g = two_nodes((0, 24), (11, 24));
    approx(tt(&g, 0, 1, 9.0).unwrap(), 2.0);
    approx(tt(&g, 0, 1, 10.0).unwrap(), 1.0);
}

#[test]
fn transit_waits_for_source_to_open() {
    let g = two_nodes((10, 20), (0, 24));
    approx(tt(&g, 0, 1, 9.0).unwrap(), 2.0); // wait 1h, travel 1h
}

#[test]
fn transit_target_closes_before_arrival() {
    // Arrive exactly at 10:00 but target is open on [0,10): closed on arrival.
    let g = two_nodes((0, 24), (0, 10));
    assert!(tt(&g, 0, 1, 9.0).is_none());
    // Arriving at 9.99 is fine.
    approx(tt(&g, 0, 1, 8.99).unwrap(), 1.0);
}

#[test]
fn transit_source_closed_forever_after_start() {
    let g = two_nodes((0, 9), (0, 24));
    assert!(tt(&g, 0, 1, 9.0).is_none());
    assert!(tt(&g, 0, 1, 8.0).is_some());
}

#[test]
fn transit_cannot_run_past_end_of_day() {
    let g = two_nodes((0, 24), (0, 24));
    assert!(tt(&g, 0, 1, 23.5).is_none()); // would arrive 24.5
    assert!(tt(&g, 0, 1, 23.0).is_none()); // arrival at 24.0 is not < 24
}

#[test]
fn transit_multi_hop_sums_legs() {
    let g = chain((0, 24));
    approx(tt(&g, 0, 2, 9.0).unwrap(), 1.0);
    approx(tt(&g, 0, 1, 9.0).unwrap(), 0.5);
    approx(tt(&g, 1, 2, 9.0).unwrap(), 0.5);
}

#[test]
fn transit_multi_hop_with_intermediate_wait() {
    // Middle node opens at 10. A->B: leave 9.5, arrive 10. B->C arrive 10.5. Total 1.5.
    let g = chain((10, 12));
    approx(tt(&g, 0, 2, 9.0).unwrap(), 1.5);
}

#[test]
fn transit_intermediate_node_closed_blocks_path() {
    // Middle node closes at 9, so it cannot be traversed at 9:00 onwards.
    let g = chain((0, 9));
    assert!(tt(&g, 0, 2, 9.0).is_none());
    assert!(tt(&g, 0, 1, 9.0).is_none());
}

fn diamond(b_open: (u8, u8)) -> TransitGraph {
    // 0 -> B(1) -> 3 and 0 -> C(2) -> 3
    build(&[
        (0, &[], 0, 24, 0.0, 0.0),
        (1, &[0], b_open.0, b_open.1, 0.0, 30.0),
        (2, &[0], 0, 24, 60.0, 0.0),
        (3, &[1, 2], 0, 24, 0.0, 60.0),
    ])
}

#[test]
fn transit_chooses_minimum_over_paths() {
    // Via B: 0.5 + 0.5 = 1.0. Via C: 1.0 + sqrt(2) ~ 2.414.
    let g = diamond((0, 24));
    approx(tt(&g, 0, 3, 9.0).unwrap(), 1.0);
}

#[test]
fn transit_falls_back_to_slower_path_when_fast_one_blocked() {
    let g = diamond((0, 9)); // B closed from 9:00
    approx(tt(&g, 0, 3, 9.0).unwrap(), 1.0 + 2f64.sqrt());
}

#[test]
fn transit_matches_reference_on_random_graphs() {
    for seed in 1..=40u64 {
        let g = random_graph(seed, 9);
        for h in [9.0, 12.5, 17.0] {
            for s in g.all_nodes().0 {
                let reference = reference_arrivals(&g, s, h);
                for t in g.all_nodes().0 {
                    let got = svc().calculate_transit_time(&g, s, t, h);
                    let want = reference.iter().find(|(k, _)| *k == t).map(|(_, a)| a - h);
                    match (got, want) {
                        (Some(a), Some(b)) => assert!((a - b).abs() < 1e-6, "seed {seed}"),
                        (None, None) => {}
                        other => panic!("seed {seed} {s:?}->{t:?} @ {h}: {other:?}"),
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------
// evaluate_performance
// ------------------------------------------------------------------

#[test]
fn performance_empty_single_and_disconnected_is_zero() {
    assert_eq!(svc().evaluate_performance(&TransitGraph::new()), 0.0);
    let single = build(&[(0, &[], 0, 24, 0.0, 0.0)]);
    assert_eq!(svc().evaluate_performance(&single), 0.0);
    let disconnected = build(&[(0, &[], 0, 24, 0.0, 0.0), (1, &[], 0, 24, 60.0, 0.0)]);
    assert_eq!(svc().evaluate_performance(&disconnected), 0.0);
}

#[test]
fn performance_single_edge() {
    approx(svc().evaluate_performance(&two_nodes((0, 24), (0, 24))), 1.0);
}

#[test]
fn performance_chain_averages_all_reachable_pairs() {
    // pairs: 0->1 (0.5), 1->2 (0.5), 0->2 (1.0) => 2/3
    approx(svc().evaluate_performance(&chain((0, 24))), 2.0 / 3.0);
}

#[test]
fn performance_averages_over_every_business_hour() {
    // Target opens at 11. Hours 9..=17 (9 samples): h=9 -> 2.0, all others 1.0.
    let g = two_nodes((0, 24), (11, 24));
    approx(svc().evaluate_performance(&g), 10.0 / 9.0);
}

#[test]
fn performance_excludes_unreachable_samples_rather_than_diluting() {
    // Source open [9,12): reachable only for starts 9,10,11, each 1.0h.
    let g = two_nodes((9, 12), (0, 24));
    approx(svc().evaluate_performance(&g), 1.0);
}

#[test]
fn performance_is_deterministic() {
    let g = random_graph(7, 12);
    let a = svc().evaluate_performance(&g);
    for _ in 0..5 {
        assert_eq!(a, svc().evaluate_performance(&g));
    }
}

#[test]
fn performance_adding_a_shortcut_never_hurts_reachability_or_time_of_pairs() {
    let mut g = chain((0, 24));
    let before = svc().evaluate_performance(&g);
    g.apply_change(&GraphChange::AddEdge { parent: NodeId(0), child: NodeId(2) }).unwrap();
    // Collinear points: the shortcut equals the two-hop time, so performance is unchanged.
    approx(svc().evaluate_performance(&g), before);
}

// ------------------------------------------------------------------
// suggest_optimal_changes
// ------------------------------------------------------------------

fn replay(g: &TransitGraph, changes: &[GraphChange]) -> TransitGraph {
    let mut out = g.clone();
    for c in changes {
        out.apply_change(c).expect("suggested change must be applicable in order");
    }
    out
}

#[test]
fn optimizer_no_changes_when_already_optimal() {
    let g = chain((0, 24));
    let r = svc().suggest_optimal_changes(&g);
    assert!(r.suggested_changes.is_empty());
    approx(r.original_performance, r.optimized_performance);
    approx(r.original_performance, svc().evaluate_performance(&g));
}

#[test]
fn optimizer_handles_trivial_graphs() {
    for g in [TransitGraph::new(), build(&[(0, &[], 0, 24, 0.0, 0.0)])] {
        let r = svc().suggest_optimal_changes(&g);
        assert!(r.suggested_changes.is_empty());
        assert_eq!(r.original_performance, 0.0);
        assert_eq!(r.optimized_performance, 0.0);
    }
}

#[test]
fn optimizer_extends_hours_to_remove_waiting() {
    let g = two_nodes((0, 24), (11, 24));
    let r = svc().suggest_optimal_changes(&g);
    approx(r.original_performance, 10.0 / 9.0);
    approx(r.optimized_performance, 1.0);
    assert_eq!(
        r.suggested_changes,
        vec![GraphChange::UpdateHours(NodeId(1), iv(10, 24))]
    );
}

#[test]
fn optimizer_adds_shortcut_edge_across_detour() {
    // 0(0,0) -> 1(0,60) -> 2(60,0): going 0->2 via 1 takes 1 + sqrt(2) h, direct is 1 h.
    let g = build(&[
        (0, &[], 0, 24, 0.0, 0.0),
        (1, &[0], 0, 24, 0.0, 60.0),
        (2, &[1], 0, 24, 60.0, 0.0),
    ]);
    let r = svc().suggest_optimal_changes(&g);
    assert_eq!(
        r.suggested_changes,
        vec![GraphChange::AddEdge { parent: NodeId(0), child: NodeId(2) }]
    );
    approx(r.original_performance, (1.0 + 2f64.sqrt() + 1.0 + 2f64.sqrt()) / 3.0);
    approx(r.optimized_performance, (1.0 + 2f64.sqrt() + 1.0) / 3.0);
    assert!(r.optimized_performance < r.original_performance);
}

#[test]
fn optimizer_respects_max_changes() {
    let g = random_graph(11, 10);
    let zero = GraphService::with_config(OptimizerConfig { max_changes: 0, ..Default::default() });
    let r = zero.suggest_optimal_changes(&g);
    assert!(r.suggested_changes.is_empty());
    approx(r.original_performance, r.optimized_performance);

    let one = GraphService::with_config(OptimizerConfig { max_changes: 1, ..Default::default() });
    assert!(one.suggest_optimal_changes(&g).suggested_changes.len() <= 1);
}

#[test]
fn optimizer_invariants_on_random_graphs() {
    for seed in 1..=15u64 {
        let g = random_graph(seed, 8);
        let r = svc().suggest_optimal_changes(&g);
        let new_g = replay(&g, &r.suggested_changes);

        // Reported original matches an independent evaluation.
        approx(r.original_performance, svc().evaluate_performance(&g));
        // Reported optimized score matches the graph produced by the changes.
        approx(r.optimized_performance, svc().evaluate_performance(&new_g));
        // Never worse, and strictly better if anything was suggested.
        assert!(r.optimized_performance <= r.original_performance + EPS, "seed {seed}");
        if !r.suggested_changes.is_empty() {
            assert!(r.optimized_performance < r.original_performance, "seed {seed}");
        }
        // Connectivity is never sacrificed.
        assert!(reachable_samples(&new_g) >= reachable_samples(&g), "seed {seed}");
        // Result is still a DAG (no node reaches itself through a child).
        for id in new_g.all_nodes().0 {
            for p in &new_g.get_node(&id).unwrap().parents.0 {
                assert!(!new_g.has_path(id, *p), "cycle in seed {seed}");
            }
        }
        // Budget respected.
        assert!(r.suggested_changes.len() <= OptimizerConfig::default().max_changes);
    }
}

#[test]
fn optimizer_does_not_mutate_input() {
    let g = two_nodes((0, 24), (11, 24));
    let before = svc().evaluate_performance(&g);
    let _ = svc().suggest_optimal_changes(&g);
    approx(svc().evaluate_performance(&g), before);
    assert_eq!(g.get_node(&NodeId(1)).unwrap().interval, iv(11, 24));
}