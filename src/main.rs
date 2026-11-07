//! HTTP API for the transit analysis library.
//!
//! Endpoints (all `POST`, JSON in / JSON out; see `API.md`):
//!   /api/upload   create a stored network from a name + file content
//!   /api/analyze  load a stored network and return the optimizer's suggestions
//!   /api/change   apply one or more changes to a stored network and save it
//!
//! Layout of this file, in dependency order:
//!   1. Data types (file format, requests, responses, errors)
//!   2. Conversions between the file format and the library's `TransitGraph`
//!   3. Core operations: load, create, change, analyze (these call the library)
//!   4. HTTP handlers and router
//!   5. Tests

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use transit::{
    Coordinates, GraphChange, GraphService, NodeId, NodeList, NodeMetadata, OptimizerConfig,
    TimeInterval, TransitAnalyzer, TransitGraph,
};

// ==========================================
// 1. Data types
// ==========================================

/// Hard limits protecting the server. The optimizer re-evaluates the whole graph for
/// every candidate change, so cost grows steeply with node count.
const DEFAULT_MAX_NODES: usize = 100;
const MAX_CHANGES_LIMIT: usize = 50;
const MAX_EDGE_CANDIDATES_LIMIT: usize = 500;

// ---- Network file format ---------------------------------------------------

/// Opening hours `[start, end)` in whole hours of the day, `0 <= start < end <= 24`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct HoursDto {
    start: u8,
    end: u8,
}

/// Position in kilometres.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CoordinatesDto {
    x: f64,
    y: f64,
}

/// One node of the network. Travel is possible from each parent to this node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NodeDto {
    id: usize,
    #[serde(default)]
    parents: Vec<usize>,
    hours: HoursDto,
    coordinates: CoordinatesDto,
}

/// The contents of a stored network file (`<storage_dir>/<name>.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NetworkFile {
    nodes: Vec<NodeDto>,
}

// ---- Changes ---------------------------------------------------------------

/// A modification of a network. Used both as input to `/api/change` and as the
/// output format of the optimizer's suggestions (which never contain `add_node`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum ChangeDto {
    /// Replace the opening hours of an existing node.
    UpdateHours { node: usize, hours: HoursDto },
    /// Add the directed edge `parent -> child`.
    AddEdge { parent: usize, child: usize },
    /// Remove the directed edge `parent -> child`.
    RemoveEdge { parent: usize, child: usize },
    /// Add a new node (its id must be unused and its parents must exist).
    AddNode { node: NodeDto },
}

impl From<&GraphChange> for ChangeDto {
    fn from(c: &GraphChange) -> Self {
        match c {
            GraphChange::UpdateHours(id, iv) => ChangeDto::UpdateHours {
                node: id.0,
                hours: HoursDto { start: iv.start(), end: iv.end() },
            },
            GraphChange::AddEdge { parent, child } => {
                ChangeDto::AddEdge { parent: parent.0, child: child.0 }
            }
            GraphChange::RemoveEdge { parent, child } => {
                ChangeDto::RemoveEdge { parent: parent.0, child: child.0 }
            }
        }
    }
}

// ---- Requests --------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AnalyzeRequest {
    #[serde(alias = "network-name", alias = "name")]
    network_name: String,
    #[serde(default)]
    config: Option<ConfigDto>,
}

/// Optional overrides for the optimizer; omitted fields keep the library defaults.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigDto {
    max_changes: Option<usize>,
    max_edge_candidates: Option<usize>,
    min_improvement: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UploadRequest {
    #[serde(alias = "network-name", alias = "name")]
    network_name: String,
    /// Either the network as a JSON object, or a string holding the file's JSON text.
    content: serde_json::Value,
    /// Replace the network if it already exists (default: reject with 409).
    #[serde(default)]
    overwrite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ChangeRequest {
    #[serde(alias = "network-name", alias = "name")]
    network_name: String,
    /// Applied in order and atomically: if any fails, nothing is saved.
    changes: Vec<ChangeDto>,
}

// ---- Responses -------------------------------------------------------------

#[derive(Debug, Serialize)]
struct AnalyzeResponse {
    network_name: String,
    /// Average transit time in hours over business hours (9..=17), before changes.
    original_performance: f64,
    /// Average transit time in hours after applying `suggested_changes` in order.
    optimized_performance: f64,
    suggested_changes: Vec<ChangeDto>,
}

#[derive(Debug, Serialize)]
struct UploadResponse {
    network_name: String,
    node_count: usize,
    /// True if an existing network was overwritten.
    replaced: bool,
}

#[derive(Debug, Serialize)]
struct ChangeResponse {
    network_name: String,
    applied: usize,
    /// The saved network after the changes.
    network: NetworkFile,
}

// ---- Errors ----------------------------------------------------------------

#[derive(Debug)]
enum ApiError {
    BadRequest(String),
    NotFound(String),
    Conflict(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            ApiError::NotFound(m) => (StatusCode::NOT_FOUND, m),
            ApiError::Conflict(m) => (StatusCode::CONFLICT, m),
            ApiError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (status, Json(serde_json::json!({ "error": msg }))).into_response()
    }
}

/// Logs the detail (which may mention server paths) and returns a generic 500.
fn internal(detail: impl std::fmt::Display) -> ApiError {
    eprintln!("internal error: {detail}");
    ApiError::Internal("internal server error".to_string())
}

// ---- Shared state ----------------------------------------------------------

struct AppState {
    storage_dir: PathBuf,
    max_nodes: usize,
    /// Serializes read-modify-write cycles (upload, change) on the storage directory.
    write_lock: Mutex<()>,
}

// ==========================================
// 2. Conversions: file format <-> library types
// ==========================================

/// Network names become file names, so they are restricted to a safe alphabet.
fn validate_name(name: &str) -> Result<(), ApiError> {
    let ok = !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "network name must be 1-64 characters from A-Z a-z 0-9 '-' '_'".to_string(),
        ))
    }
}

fn network_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.json"))
}

fn to_metadata(n: &NodeDto) -> Result<NodeMetadata, String> {
    let interval = TimeInterval::new(n.hours.start, n.hours.end)
        .map_err(|e| format!("node {}: {e}", n.id))?;
    Ok(NodeMetadata {
        parents: NodeList(n.parents.iter().map(|&p| NodeId(p)).collect()),
        interval,
        coordinates: Coordinates(n.coordinates.x, n.coordinates.y),
    })
}

/// Validates a network file and builds the library graph from it. Nodes may be listed
/// in any order (the library needs parents inserted first, so this orders them).
fn build_graph(net: &NetworkFile, max_nodes: usize) -> Result<TransitGraph, String> {
    if net.nodes.len() > max_nodes {
        return Err(format!("network has {} nodes; the limit is {max_nodes}", net.nodes.len()));
    }
    let mut by_id: HashMap<usize, &NodeDto> = HashMap::new();
    for n in &net.nodes {
        if by_id.insert(n.id, n).is_some() {
            return Err(format!("duplicate node id {}", n.id));
        }
    }
    for n in &net.nodes {
        for p in &n.parents {
            if *p == n.id {
                return Err(format!("node {} lists itself as a parent", n.id));
            }
            if !by_id.contains_key(p) {
                return Err(format!("node {} has unknown parent {p}", n.id));
            }
        }
    }

    let mut remaining: Vec<usize> = by_id.keys().copied().collect();
    remaining.sort_unstable();
    let mut inserted: HashSet<usize> = HashSet::new();
    let mut graph = TransitGraph::new();
    while !remaining.is_empty() {
        let mut next = Vec::new();
        for id in &remaining {
            let n = by_id[id];
            if n.parents.iter().all(|p| inserted.contains(p)) {
                graph
                    .add_node(NodeId(*id), to_metadata(n)?)
                    .map_err(|e| format!("node {id}: {e}"))?;
                inserted.insert(*id);
            } else {
                next.push(*id);
            }
        }
        if next.len() == remaining.len() {
            return Err("network contains a cycle".to_string());
        }
        remaining = next;
    }
    Ok(graph)
}

/// Canonical file representation: nodes sorted by id, parents sorted and de-duplicated.
fn graph_to_network(graph: &TransitGraph) -> NetworkFile {
    let nodes = graph
        .all_nodes()
        .0
        .into_iter()
        .map(|id| {
            let m = graph.get_node(&id).expect("id came from the graph");
            let mut parents: Vec<usize> = m.parents.0.iter().map(|p| p.0).collect();
            parents.sort_unstable();
            NodeDto {
                id: id.0,
                parents,
                hours: HoursDto { start: m.interval.start(), end: m.interval.end() },
                coordinates: CoordinatesDto { x: m.coordinates.0, y: m.coordinates.1 },
            }
        })
        .collect();
    NetworkFile { nodes }
}

/// Applies one API change to the in-memory graph via the library.
fn apply_change_dto(graph: &mut TransitGraph, change: &ChangeDto, max_nodes: usize) -> Result<(), String> {
    let lib_change = match change {
        ChangeDto::UpdateHours { node, hours } => {
            let iv = TimeInterval::new(hours.start, hours.end).map_err(|e| e.to_string())?;
            GraphChange::UpdateHours(NodeId(*node), iv)
        }
        ChangeDto::AddEdge { parent, child } => {
            GraphChange::AddEdge { parent: NodeId(*parent), child: NodeId(*child) }
        }
        ChangeDto::RemoveEdge { parent, child } => {
            GraphChange::RemoveEdge { parent: NodeId(*parent), child: NodeId(*child) }
        }
        ChangeDto::AddNode { node } => {
            if graph.get_node(&NodeId(node.id)).is_some() {
                return Err(format!("node {} already exists", node.id));
            }
            if graph.len() >= max_nodes {
                return Err(format!("network is at the {max_nodes}-node limit"));
            }
            return graph
                .add_node(NodeId(node.id), to_metadata(node)?)
                .map_err(|e| format!("node {}: {e}", node.id));
        }
    };
    graph.apply_change(&lib_change).map_err(|e| e.to_string())
}

// ==========================================
// 3. Core operations
// ==========================================

/// Writes the file atomically (temp file + rename) so readers never see a partial write.
async fn save_network(dir: &Path, name: &str, net: &NetworkFile) -> Result<(), ApiError> {
    tokio::fs::create_dir_all(dir).await.map_err(internal)?;
    let json = serde_json::to_vec_pretty(net).map_err(internal)?;
    let tmp = dir.join(format!(".{name}.json.tmp"));
    tokio::fs::write(&tmp, json).await.map_err(internal)?;
    tokio::fs::rename(&tmp, network_path(dir, name)).await.map_err(internal)?;
    Ok(())
}

/// Loads `<storage_dir>/<name>.json` and builds the library graph from it.
async fn load_network(state: &AppState, name: &str) -> Result<(NetworkFile, TransitGraph), ApiError> {
    validate_name(name)?;
    let text = match tokio::fs::read_to_string(network_path(&state.storage_dir, name)).await {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(ApiError::NotFound(format!("network '{name}' not found")))
        }
        Err(e) => return Err(internal(e)),
    };
    let net: NetworkFile = serde_json::from_str(&text)
        .map_err(|e| ApiError::Internal(format!("stored network '{name}' is not valid: {e}")))?;
    let graph = build_graph(&net, state.max_nodes)
        .map_err(|e| ApiError::Internal(format!("stored network '{name}' is not valid: {e}")))?;
    Ok((net, graph))
}

/// Validates and stores a new network. Returns whether an existing one was replaced.
async fn create_network(
    state: &AppState,
    name: &str,
    net: &NetworkFile,
    overwrite: bool,
) -> Result<bool, ApiError> {
    validate_name(name)?;
    let graph = build_graph(net, state.max_nodes).map_err(ApiError::BadRequest)?;
    let canonical = graph_to_network(&graph);

    let _guard = state.write_lock.lock().await;
    let exists = tokio::fs::try_exists(network_path(&state.storage_dir, name))
        .await
        .map_err(internal)?;
    if exists && !overwrite {
        return Err(ApiError::Conflict(format!(
            "network '{name}' already exists (set \"overwrite\": true to replace it)"
        )));
    }
    save_network(&state.storage_dir, name, &canonical).await?;
    Ok(exists)
}

/// Applies `changes` in order to the stored network; saves only if all succeed.
async fn change_network(
    state: &AppState,
    name: &str,
    changes: &[ChangeDto],
) -> Result<NetworkFile, ApiError> {
    validate_name(name)?;
    if changes.is_empty() {
        return Err(ApiError::BadRequest("\"changes\" must not be empty".to_string()));
    }
    let _guard = state.write_lock.lock().await;
    let (_, mut graph) = load_network(state, name).await?;
    for (i, change) in changes.iter().enumerate() {
        apply_change_dto(&mut graph, change, state.max_nodes)
            .map_err(|e| ApiError::BadRequest(format!("change #{i}: {e}")))?;
    }
    let updated = graph_to_network(&graph);
    save_network(&state.storage_dir, name, &updated).await?;
    Ok(updated)
}

/// Loads the network and runs the library's optimizer on a blocking thread.
async fn analyze_network(
    state: &AppState,
    name: &str,
    config: Option<ConfigDto>,
) -> Result<AnalyzeResponse, ApiError> {
    let mut cfg = OptimizerConfig::default();
    if let Some(c) = config {
        if let Some(v) = c.max_changes {
            if v > MAX_CHANGES_LIMIT {
                return Err(ApiError::BadRequest(format!("max_changes must be <= {MAX_CHANGES_LIMIT}")));
            }
            cfg.max_changes = v;
        }
        if let Some(v) = c.max_edge_candidates {
            if v > MAX_EDGE_CANDIDATES_LIMIT {
                return Err(ApiError::BadRequest(format!(
                    "max_edge_candidates must be <= {MAX_EDGE_CANDIDATES_LIMIT}"
                )));
            }
            cfg.max_edge_candidates = v;
        }
        if let Some(v) = c.min_improvement {
            if !v.is_finite() || v < 0.0 {
                return Err(ApiError::BadRequest("min_improvement must be a finite number >= 0".to_string()));
            }
            cfg.min_improvement = v;
        }
    }

    let (_, graph) = load_network(state, name).await?;
    let service = GraphService::with_config(cfg);
    let result = tokio::task::spawn_blocking(move || service.suggest_optimal_changes(&graph))
        .await
        .map_err(internal)?;

    Ok(AnalyzeResponse {
        network_name: name.to_string(),
        original_performance: result.original_performance,
        optimized_performance: result.optimized_performance,
        suggested_changes: result.suggested_changes.iter().map(ChangeDto::from).collect(),
    })
}

// ==========================================
// 4. HTTP layer
// ==========================================

/// Parses a JSON body ourselves so every failure is a JSON `{"error": ...}` response.
fn parse_json<T: DeserializeOwned>(body: &[u8]) -> Result<T, ApiError> {
    serde_json::from_slice(body).map_err(|e| ApiError::BadRequest(format!("invalid request body: {e}")))
}

/// `content` may be the network object itself or a string containing its JSON text.
fn parse_content(content: serde_json::Value) -> Result<NetworkFile, ApiError> {
    let parsed = match content {
        serde_json::Value::String(text) => serde_json::from_str(&text),
        other => serde_json::from_value(other),
    };
    parsed.map_err(|e| ApiError::BadRequest(format!("\"content\" is not a valid network file: {e}")))
}

async fn analyze_handler(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<Json<AnalyzeResponse>, ApiError> {
    let req: AnalyzeRequest = parse_json(&body)?;
    Ok(Json(analyze_network(&state, &req.network_name, req.config).await?))
}

async fn upload_handler(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<Response, ApiError> {
    let req: UploadRequest = parse_json(&body)?;
    let net = parse_content(req.content)?;
    let replaced = create_network(&state, &req.network_name, &net, req.overwrite).await?;
    let status = if replaced { StatusCode::OK } else { StatusCode::CREATED };
    let resp = UploadResponse {
        network_name: req.network_name,
        node_count: net.nodes.len(),
        replaced,
    };
    Ok((status, Json(resp)).into_response())
}

async fn change_handler(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<Json<ChangeResponse>, ApiError> {
    let req: ChangeRequest = parse_json(&body)?;
    let network = change_network(&state, &req.network_name, &req.changes).await?;
    Ok(Json(ChangeResponse {
        network_name: req.network_name,
        applied: req.changes.len(),
        network,
    }))
}

fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/analyze", post(analyze_handler))
        .route("/api/upload", post(upload_handler))
        .route("/api/change", post(change_handler))
        .with_state(state)
}

/// Configuration via environment variables:
///   TRANSIT_ADDR         listen address            (default 127.0.0.1:3000)
///   TRANSIT_STORAGE_DIR  where networks are stored (default ./networks)
///   TRANSIT_MAX_NODES    max nodes per network     (default 100)
#[tokio::main]
async fn main() {
    let addr: SocketAddr = std::env::var("TRANSIT_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3001".to_string())
        .parse()
        .expect("TRANSIT_ADDR must be a socket address like 127.0.0.1:3001");
    let storage_dir = PathBuf::from(
        std::env::var("TRANSIT_STORAGE_DIR").unwrap_or_else(|_| "networks".to_string()),
    );
    let max_nodes = std::env::var("TRANSIT_MAX_NODES")
        .ok()
        .map(|v| v.parse().expect("TRANSIT_MAX_NODES must be a positive integer"))
        .unwrap_or(DEFAULT_MAX_NODES);

    tokio::fs::create_dir_all(&storage_dir)
        .await
        .expect("could not create storage directory");

    let state = Arc::new(AppState { storage_dir: storage_dir.clone(), max_nodes, write_lock: Mutex::new(()) });
    let listener = tokio::net::TcpListener::bind(addr).await.expect("could not bind address");
    println!("transit-server listening on http://{addr} (storage: {})", storage_dir.display());
    axum::serve(listener, app(state)).await.expect("server error");
}

// ==========================================
// 5. Tests
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A router backed by a unique temp directory that is removed on drop.
    struct TestApp {
        router: Router,
        dir: PathBuf,
    }

    impl TestApp {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "transit-api-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::SeqCst)
            ));
            let state = Arc::new(AppState {
                storage_dir: dir.clone(),
                max_nodes: DEFAULT_MAX_NODES,
                write_lock: Mutex::new(()),
            });
            Self { router: app(state), dir }
        }

        async fn post(&self, path: &str, body: Value) -> (StatusCode, Value) {
            self.post_raw(path, body.to_string()).await
        }

        async fn post_raw(&self, path: &str, body: String) -> (StatusCode, Value) {
            let req = Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap();
            let resp = self.router.clone().oneshot(req).await.unwrap();
            let status = resp.status();
            let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            (status, serde_json::from_slice(&bytes).expect("response must be JSON"))
        }

        fn file(&self, name: &str) -> PathBuf {
            network_path(&self.dir, name)
        }
    }

    impl Drop for TestApp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn node(id: usize, parents: &[usize], start: u8, end: u8, x: f64, y: f64) -> Value {
        json!({"id": id, "parents": parents, "hours": {"start": start, "end": end},
               "coordinates": {"x": x, "y": y}})
    }

    /// 0(0,0) -> 1(0,60) -> 2(60,0): a detour where a direct 0 -> 2 edge helps.
    fn detour_network() -> Value {
        json!({"nodes": [
            node(0, &[], 0, 24, 0.0, 0.0),
            node(1, &[0], 0, 24, 0.0, 60.0),
            node(2, &[1], 0, 24, 60.0, 0.0),
        ]})
    }

    /// 0 -> 1 where node 1 opens at 11 (so waiting can be removed by opening earlier).
    fn late_open_network() -> Value {
        json!({"nodes": [node(0, &[], 0, 24, 0.0, 0.0), node(1, &[0], 11, 24, 60.0, 0.0)]})
    }

    async fn upload(app: &TestApp, name: &str, content: Value) {
        let (s, b) = app.post("/api/upload", json!({"network_name": name, "content": content})).await;
        assert_eq!(s, StatusCode::CREATED, "{b}");
    }

    // ---- conversions ----

    #[test]
    fn build_graph_accepts_any_node_order_and_round_trips_canonically() {
        let net: NetworkFile = serde_json::from_value(json!({"nodes": [
            node(2, &[1, 0], 9, 17, 2.0, 0.0),
            node(1, &[0], 0, 24, 1.0, 0.0),
            node(0, &[], 0, 24, 0.0, 0.0),
        ]}))
        .unwrap();
        let g = build_graph(&net, 10).unwrap();
        let back = graph_to_network(&g);
        let ids: Vec<usize> = back.nodes.iter().map(|n| n.id).collect();
        assert_eq!(ids, vec![0, 1, 2]);
        assert_eq!(back.nodes[2].parents, vec![0, 1]); // sorted
        assert_eq!(build_graph(&back, 10).unwrap().len(), 3);
    }

    #[test]
    fn build_graph_rejects_invalid_networks() {
        let bad = |v: Value| build_graph(&serde_json::from_value(v).unwrap(), 10).unwrap_err();
        assert!(bad(json!({"nodes": [node(0, &[], 0, 24, 0.0, 0.0), node(0, &[], 0, 24, 1.0, 1.0)]}))
            .contains("duplicate"));
        assert!(bad(json!({"nodes": [node(0, &[5], 0, 24, 0.0, 0.0)]})).contains("unknown parent"));
        assert!(bad(json!({"nodes": [node(0, &[0], 0, 24, 0.0, 0.0)]})).contains("itself"));
        assert!(bad(json!({"nodes": [node(0, &[], 10, 10, 0.0, 0.0)]})).contains("Invalid interval"));
        assert!(bad(json!({"nodes": [node(0, &[1], 0, 24, 0.0, 0.0), node(1, &[0], 0, 24, 1.0, 0.0)]}))
            .contains("cycle"));
        let many: Vec<Value> = (0..11).map(|i| node(i, &[], 0, 24, 0.0, 0.0)).collect();
        assert!(bad(json!({"nodes": many})).contains("limit"));
    }

    #[test]
    fn validate_name_blocks_path_tricks() {
        for ok in ["a", "net_1", "My-Net", &"x".repeat(64)] {
            assert!(validate_name(ok).is_ok(), "{ok}");
        }
        for bad in ["", "../x", "a/b", "a.b", "a b", "x\\y", &"x".repeat(65)] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
    }

    // ---- /api/upload ----

    #[tokio::test]
    async fn upload_creates_file_and_reports_counts() {
        let app = TestApp::new();
        let (s, b) = app
            .post("/api/upload", json!({"network_name": "demo", "content": detour_network()}))
            .await;
        assert_eq!(s, StatusCode::CREATED);
        assert_eq!(b["node_count"], 3);
        assert_eq!(b["replaced"], false);
        assert!(app.file("demo").exists());
    }

    #[tokio::test]
    async fn upload_accepts_content_as_json_string_and_name_aliases() {
        let app = TestApp::new();
        let text = detour_network().to_string();
        let (s, _) = app.post("/api/upload", json!({"name": "a", "content": text})).await;
        assert_eq!(s, StatusCode::CREATED);
        let (s, _) = app
            .post("/api/upload", json!({"network-name": "b", "content": detour_network()}))
            .await;
        assert_eq!(s, StatusCode::CREATED);
    }

    #[tokio::test]
    async fn upload_conflict_then_overwrite() {
        let app = TestApp::new();
        upload(&app, "demo", detour_network()).await;
        let (s, b) = app
            .post("/api/upload", json!({"network_name": "demo", "content": late_open_network()}))
            .await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert!(b["error"].as_str().unwrap().contains("already exists"));

        let (s, b) = app
            .post(
                "/api/upload",
                json!({"network_name": "demo", "content": late_open_network(), "overwrite": true}),
            )
            .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b["replaced"], true);
        assert_eq!(b["node_count"], 2);
    }

    #[tokio::test]
    async fn upload_rejects_invalid_input_and_writes_nothing() {
        let app = TestApp::new();
        let cases = vec![
            json!({"network_name": "../evil", "content": detour_network()}),
            json!({"network_name": "ok", "content": {"nodes": [node(0, &[1], 0, 24, 0.0, 0.0), node(1, &[0], 0, 24, 1.0, 0.0)]}}),
            json!({"network_name": "ok", "content": {"nodes": [node(0, &[], 5, 5, 0.0, 0.0)]}}),
            json!({"network_name": "ok", "content": {"nodez": []}}),
            json!({"network_name": "ok", "content": "not json"}),
            json!({"network_name": "ok"}),
            json!({"network_name": "ok", "content": detour_network(), "extra": 1}),
        ];
        for c in cases {
            let (s, b) = app.post("/api/upload", c.clone()).await;
            assert_eq!(s, StatusCode::BAD_REQUEST, "{c} -> {b}");
            assert!(b["error"].is_string());
        }
        assert!(!app.file("ok").exists());
    }

    #[tokio::test]
    async fn malformed_json_body_is_a_json_400() {
        let app = TestApp::new();
        let (s, b) = app.post_raw("/api/analyze", "{not json".to_string()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        assert!(b["error"].as_str().unwrap().contains("invalid request body"));
    }

    // ---- /api/analyze ----

    #[tokio::test]
    async fn analyze_returns_shortcut_suggestion() {
        let app = TestApp::new();
        upload(&app, "demo", detour_network()).await;
        let (s, b) = app.post("/api/analyze", json!({"network_name": "demo"})).await;
        assert_eq!(s, StatusCode::OK, "{b}");
        assert_eq!(b["suggested_changes"], json!([{"type": "add_edge", "parent": 0, "child": 2}]));
        let sqrt2 = 2f64.sqrt();
        let orig = b["original_performance"].as_f64().unwrap();
        let opt = b["optimized_performance"].as_f64().unwrap();
        assert!((orig - (2.0 * (1.0 + sqrt2)) / 3.0).abs() < 1e-9);
        assert!((opt - (2.0 + sqrt2) / 3.0).abs() < 1e-9);
    }

    #[tokio::test]
    async fn analyze_returns_hours_suggestion() {
        let app = TestApp::new();
        upload(&app, "late", late_open_network()).await;
        let (_, b) = app.post("/api/analyze", json!({"network-name": "late"})).await;
        assert_eq!(
            b["suggested_changes"],
            json!([{"type": "update_hours", "node": 1, "hours": {"start": 10, "end": 24}}])
        );
        assert!((b["optimized_performance"].as_f64().unwrap() - 1.0).abs() < 1e-9);
    }

    #[tokio::test]
    async fn analyze_config_and_errors() {
        let app = TestApp::new();
        upload(&app, "demo", detour_network()).await;

        let (s, b) = app
            .post("/api/analyze", json!({"network_name": "demo", "config": {"max_changes": 0}}))
            .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(b["suggested_changes"], json!([]));

        for cfg in [json!({"max_changes": 1000}), json!({"min_improvement": -1.0}), json!({"bogus": 1})] {
            let (s, _) = app.post("/api/analyze", json!({"network_name": "demo", "config": cfg})).await;
            assert_eq!(s, StatusCode::BAD_REQUEST);
        }

        let (s, _) = app.post("/api/analyze", json!({"network_name": "missing"})).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        let (s, _) = app.post("/api/analyze", json!({"network_name": "../etc/passwd"})).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn analyze_corrupt_stored_file_is_a_500() {
        let app = TestApp::new();
        std::fs::create_dir_all(&app.dir).unwrap();
        std::fs::write(app.file("broken"), "{ nope").unwrap();
        let (s, b) = app.post("/api/analyze", json!({"network_name": "broken"})).await;
        assert_eq!(s, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(b["error"].as_str().unwrap().contains("not valid"));
    }

    // ---- /api/change ----

    #[tokio::test]
    async fn change_applies_and_persists_and_affects_analysis() {
        let app = TestApp::new();
        upload(&app, "late", late_open_network()).await;
        let (s, b) = app
            .post(
                "/api/change",
                json!({"network_name": "late", "changes": [
                    {"type": "update_hours", "node": 1, "hours": {"start": 10, "end": 24}}
                ]}),
            )
            .await;
        assert_eq!(s, StatusCode::OK, "{b}");
        assert_eq!(b["applied"], 1);
        assert_eq!(b["network"]["nodes"][1]["hours"], json!({"start": 10, "end": 24}));

        // Now already optimal for the hours problem: nothing left to suggest.
        let (_, b) = app.post("/api/analyze", json!({"network_name": "late"})).await;
        assert_eq!(b["suggested_changes"], json!([]));
    }

    #[tokio::test]
    async fn change_can_apply_suggestions_from_analyze() {
        let app = TestApp::new();
        upload(&app, "demo", detour_network()).await;
        let (_, a) = app.post("/api/analyze", json!({"network_name": "demo"})).await;
        let (s, _) = app
            .post("/api/change", json!({"network_name": "demo", "changes": a["suggested_changes"]}))
            .await;
        assert_eq!(s, StatusCode::OK);
        let (_, a2) = app.post("/api/analyze", json!({"network_name": "demo"})).await;
        let before = a["optimized_performance"].as_f64().unwrap();
        let after = a2["original_performance"].as_f64().unwrap();
        assert!((before - after).abs() < 1e-9);
    }

    #[tokio::test]
    async fn change_edges_and_nodes() {
        let app = TestApp::new();
        upload(&app, "demo", detour_network()).await;

        let (s, b) = app
            .post(
                "/api/change",
                json!({"network_name": "demo", "changes": [
                    {"type": "add_edge", "parent": 0, "child": 2},
                    {"type": "remove_edge", "parent": 1, "child": 2},
                    {"type": "add_node", "node": node(3, &[2], 8, 20, 90.0, 0.0)}
                ]}),
            )
            .await;
        assert_eq!(s, StatusCode::OK, "{b}");
        assert_eq!(b["applied"], 3);
        assert_eq!(b["network"]["nodes"][2]["parents"], json!([0]));
        assert_eq!(b["network"]["nodes"].as_array().unwrap().len(), 4);
        let on_disk: NetworkFile =
            serde_json::from_str(&std::fs::read_to_string(app.file("demo")).unwrap()).unwrap();
        assert_eq!(on_disk.nodes.len(), 4);
    }

    #[tokio::test]
    async fn change_is_atomic_when_a_later_change_fails() {
        let app = TestApp::new();
        upload(&app, "demo", detour_network()).await;
        let before = std::fs::read_to_string(app.file("demo")).unwrap();
        let (s, b) = app
            .post(
                "/api/change",
                json!({"network_name": "demo", "changes": [
                    {"type": "update_hours", "node": 0, "hours": {"start": 1, "end": 2}},
                    {"type": "add_edge", "parent": 2, "child": 0}
                ]}),
            )
            .await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        assert!(b["error"].as_str().unwrap().starts_with("change #1"), "{b}");
        assert_eq!(std::fs::read_to_string(app.file("demo")).unwrap(), before);
    }

    #[tokio::test]
    async fn change_rejects_bad_input() {
        let app = TestApp::new();
        upload(&app, "demo", detour_network()).await;
        let bad = vec![
            json!({"network_name": "demo", "changes": []}),
            json!({"network_name": "demo", "changes": [{"type": "explode"}]}),
            json!({"network_name": "demo", "changes": [{"type": "update_hours", "node": 9, "hours": {"start": 1, "end": 2}}]}),
            json!({"network_name": "demo", "changes": [{"type": "update_hours", "node": 0, "hours": {"start": 5, "end": 5}}]}),
            json!({"network_name": "demo", "changes": [{"type": "add_edge", "parent": 0, "child": 1}]}),
            json!({"network_name": "demo", "changes": [{"type": "remove_edge", "parent": 0, "child": 2}]}),
            json!({"network_name": "demo", "changes": [{"type": "add_node", "node": node(0, &[], 0, 24, 0.0, 0.0)}]}),
            json!({"network_name": "demo", "changes": [{"type": "add_node", "node": node(7, &[42], 0, 24, 0.0, 0.0)}]}),
        ];
        for c in bad {
            let (s, b) = app.post("/api/change", c.clone()).await;
            assert_eq!(s, StatusCode::BAD_REQUEST, "{c} -> {b}");
        }
        let (s, _) = app
            .post("/api/change", json!({"network_name": "nope", "changes": [{"type": "add_edge", "parent": 0, "child": 1}]}))
            .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn concurrent_changes_are_not_lost() {
        let app = TestApp::new();
        let nodes: Vec<Value> = (0..10).map(|i| node(i, &[], 0, 24, i as f64, 0.0)).collect();
        upload(&app, "wide", json!({"nodes": nodes})).await;
        let mut tasks = Vec::new();
        for i in 1..10 {
            let router = app.router.clone();
            tasks.push(tokio::spawn(async move {
                let body = json!({"network_name": "wide", "changes": [{"type": "add_edge", "parent": 0, "child": i}]});
                let req = Request::builder()
                    .method("POST")
                    .uri("/api/change")
                    .body(Body::from(body.to_string()))
                    .unwrap();
                router.oneshot(req).await.unwrap().status()
            }));
        }
        for t in tasks {
            assert_eq!(t.await.unwrap(), StatusCode::OK);
        }
        let on_disk: NetworkFile =
            serde_json::from_str(&std::fs::read_to_string(app.file("wide")).unwrap()).unwrap();
        let edges: usize = on_disk.nodes.iter().map(|n| n.parents.len()).sum();
        assert_eq!(edges, 9);
    }
}