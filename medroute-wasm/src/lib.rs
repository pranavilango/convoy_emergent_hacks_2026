//! The medroute allocator as a WebAssembly module, so the Convoy web app can run it inside its own
//! API route instead of calling a separate HTTP service. Same library, same results as
//! `POST /api/analyze` (see ../API.md); only the transport differs.
//!
//! A tiny C-style ABI with no imports (no wasm-bindgen needed):
//! 1. `medroute_alloc(len)` reserves `len` bytes; the host copies the graph JSON there.
//! 2. `medroute_analyze(ptr, len, n)` frees that input and returns a pointer to the result:
//!    a 4-byte little-endian length followed by that many bytes of JSON, either
//!    `{"ok": <AnalyzeResponse>}` or `{"error": "<message>", "status": 400 | 422}`
//!    (the statuses the HTTP server would use).
//! 3. `medroute_free(ptr, len)` releases the result (`len` = 4 + JSON length).

use medroute::{analyze_bytes, AnalyzeError, InputError, SolverConfig, Strategy};

// Buffers cross the boundary as boxed slices, so their length is exactly their allocation size
// and they can be rebuilt and freed from (ptr, len) alone.

fn into_raw(bytes: Box<[u8]>) -> *mut u8 {
    Box::into_raw(bytes) as *mut u8
}

unsafe fn from_raw(ptr: *mut u8, len: usize) -> Box<[u8]> {
    Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len))
}

#[no_mangle]
pub extern "C" fn medroute_alloc(len: usize) -> *mut u8 {
    into_raw(vec![0u8; len].into_boxed_slice())
}

/// # Safety
/// `ptr` and `len` must come from `medroute_alloc` or `medroute_analyze`, freed once.
#[no_mangle]
pub unsafe extern "C" fn medroute_free(ptr: *mut u8, len: usize) {
    drop(from_raw(ptr, len));
}

/// # Safety
/// `ptr` must point to `len` bytes reserved with `medroute_alloc(len)` and written by the host.
#[no_mangle]
pub unsafe extern "C" fn medroute_analyze(ptr: *mut u8, len: usize, n: u32) -> *mut u8 {
    let input = from_raw(ptr, len);
    let json = match analyze_bytes(&input, n as usize, Strategy::Auto, &SolverConfig::default()) {
        Ok(response) => serde_json::json!({ "ok": response }),
        Err(error) => {
            // Same mapping as the HTTP server: unparseable files are 400, invalid networks 422.
            let status = match error {
                AnalyzeError::Input(InputError::Json(_)) => 400,
                _ => 422,
            };
            serde_json::json!({ "error": error.to_string(), "status": status })
        }
    };
    drop(input);
    let body = json.to_string().into_bytes();
    let mut out = Vec::with_capacity(4 + body.len());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    into_raw(out.into_boxed_slice())
}
