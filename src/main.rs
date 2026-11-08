//! HTTP server for the medroute analyzer.
//!
//! Endpoints:
//! * `POST /api/analyze?n=<int>[&strategy=auto|exact|greedy]` – multipart upload
//!   with the graph JSON in a part named `file`.
//! * `GET /health` – liveness probe.
//!
//! All the algorithmic work lives in the library crate; this file only maps
//! HTTP to library calls and library errors to HTTP statuses.
//! Configuration comes from environment variables (see README.md).

use std::process::ExitCode;

use axum::extract::{DefaultBodyLimit, Multipart, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use medroute::{
    analyze_bytes, AnalyzeError, AnalyzeResponse, InputError, ServerSettings, SolverConfig,
    Strategy,
};
use serde::{Deserialize, Serialize};

/// Shared, read-only state handed to every request.
#[derive(Debug, Clone, Copy)]
struct AppState {
    solver: SolverConfig,
}

/// Query string of `/api/analyze`.
#[derive(Debug, Deserialize)]
struct AnalyzeParams {
    n: usize,
    strategy: Option<Strategy>,
}

/// JSON body of every error response.
#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

/// Everything a handler can fail with.
#[derive(Debug)]
enum ApiError {
    /// The multipart body could not be read (bad framing, body too large, ...).
    Multipart(StatusCode, String),
    /// No part named `file` was present.
    MissingFile,
    /// The library rejected the input or could not solve it.
    Analyze(AnalyzeError),
    /// The worker thread panicked or was cancelled.
    Internal(String),
}

impl ApiError {
    fn status(&self) -> StatusCode {
        match self {
            ApiError::Multipart(status, _) => *status,
            ApiError::MissingFile => StatusCode::BAD_REQUEST,
            ApiError::Analyze(AnalyzeError::Input(InputError::Json(_))) => StatusCode::BAD_REQUEST,
            ApiError::Analyze(_) => StatusCode::UNPROCESSABLE_ENTITY,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn message(&self) -> String {
        match self {
            ApiError::Multipart(_, m) => format!("could not read multipart body: {m}"),
            ApiError::MissingFile => "multipart part named `file` is required".to_owned(),
            ApiError::Analyze(e) => e.to_string(),
            ApiError::Internal(m) => format!("internal error: {m}"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorBody {
            error: self.message(),
        };
        (self.status(), Json(body)).into_response()
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn analyze(
    State(state): State<AppState>,
    Query(params): Query<AnalyzeParams>,
    mut multipart: Multipart,
) -> Result<Json<AnalyzeResponse>, ApiError> {
    let mut file_bytes = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::Multipart(e.status(), e.body_text()))?
    {
        if field.name() == Some("file") {
            let bytes = field
                .bytes()
                .await
                .map_err(|e| ApiError::Multipart(e.status(), e.body_text()))?;
            file_bytes = Some(bytes);
            break;
        }
    }
    let bytes = file_bytes.ok_or(ApiError::MissingFile)?;

    let strategy = params.strategy.unwrap_or_default();
    let n = params.n;
    let solver = state.solver;
    // The search is CPU-bound; keep it off the async worker threads.
    let response = tokio::task::spawn_blocking(move || analyze_bytes(&bytes, n, strategy, &solver))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .map_err(ApiError::Analyze)?;
    Ok(Json(response))
}

fn build_router(settings: &ServerSettings) -> Router {
    let state = AppState {
        solver: settings.solver,
    };
    Router::new()
        .route("/health", get(health))
        .route("/api/analyze", post(analyze))
        .layer(DefaultBodyLimit::max(settings.max_upload_bytes))
        .with_state(state)
}

#[tokio::main]
async fn main() -> ExitCode {
    // Optional `.env` file in the working directory; real environment wins.
    let _ = dotenvy::dotenv();

    let settings = match ServerSettings::from_env() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("configuration error: {e}");
            return ExitCode::FAILURE;
        }
    };

    let addr = settings.socket_addr();
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("cannot bind {addr}: {e}");
            return ExitCode::FAILURE;
        }
    };
    println!(
        "medroute listening on http://{addr} (max upload {} bytes, exact search limit {} combinations)",
        settings.max_upload_bytes, settings.solver.exact_max_combinations
    );

    match axum::serve(listener, build_router(&settings)).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("server error: {e}");
            ExitCode::FAILURE
        }
    }
}