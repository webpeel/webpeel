"""Custom exceptions for WebPeel SDK."""


class WebPeelError(Exception):
    """Base exception for all WebPeel errors."""
    pass


class AuthError(WebPeelError):
    """Authentication or authorization error."""
    pass


class RateLimitError(WebPeelError):
    """Rate limit exceeded."""
    pass


class TimeoutError(WebPeelError):
    """Request timeout error."""
    pass
