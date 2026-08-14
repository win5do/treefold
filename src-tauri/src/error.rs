use axum::{
    extract::{rejection::JsonRejection, FromRequest, Request},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("not found")]
    NotFound,
    #[error("{message}")]
    Api {
        status: StatusCode,
        code: &'static str,
        message: String,
        details: Option<Value>,
    },
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

impl AppError {
    pub fn api(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self::Api {
            status,
            code,
            message: message.into(),
            details: None,
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        match value {
            rusqlite::Error::QueryReturnedNoRows => Self::NotFound,
            other => Self::Internal(other.into()),
        }
    }
}

impl From<async_sqlite::Error> for AppError {
    fn from(value: async_sqlite::Error) -> Self {
        Self::Internal(value.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, details) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", message, None),
            Self::NotFound => (StatusCode::NOT_FOUND, "NOT_FOUND", "not found".into(), None),
            Self::Api {
                status,
                code,
                message,
                details,
            } => (status, code, message, details),
            Self::Internal(error) => {
                log::error!("internal API error: {error:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    "internal server error".into(),
                    None,
                )
            }
        };
        (
            status,
            Json(ErrorResponse {
                error: ErrorBody {
                    code,
                    message,
                    details,
                },
            }),
        )
            .into_response()
    }
}

#[derive(Serialize)]
struct ErrorResponse {
    error: ErrorBody,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<Value>,
}

pub type Result<T> = std::result::Result<T, AppError>;

pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    T: DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self> {
        Json::<T>::from_request(req, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|rejection: JsonRejection| {
                AppError::api(rejection.status(), "INVALID_JSON", rejection.body_text())
            })
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, response::IntoResponse};
    use serde_json::{json, Value};

    use super::AppError;

    #[tokio::test]
    async fn bad_request_uses_the_structured_error_contract() {
        let response = AppError::BadRequest("name is required".into()).into_response();

        assert_eq!(response.status(), axum::http::StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            value,
            json!({
                "error": {
                    "code": "BAD_REQUEST",
                    "message": "name is required"
                }
            })
        );
    }

    #[tokio::test]
    async fn internal_errors_do_not_expose_implementation_details() {
        let response =
            AppError::Internal(anyhow::anyhow!("database password leaked")).into_response();

        assert_eq!(
            response.status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["error"]["code"], "INTERNAL_ERROR");
        assert_eq!(value["error"]["message"], "internal server error");
        assert!(!String::from_utf8_lossy(&body).contains("database password"));
    }
}
