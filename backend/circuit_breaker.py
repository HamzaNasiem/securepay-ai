import time
import logging
from typing import Callable, Any

logger = logging.getLogger(__name__)

class CircuitBreakerOpenException(Exception):
    """Raised when the circuit breaker is open and rejects calls."""
    pass

class CircuitBreaker:
    """
    Production-grade Circuit Breaker pattern implementation.
    Prevents cascading failures by tripping to 'open' state on repeated API timeouts or failures,
    instantly routing traffic to the local fast-path heuristics / ML scoring engine.
    """
    def __init__(self, failure_threshold: int = 3, recovery_timeout_seconds: float = 30.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout_seconds = recovery_timeout_seconds
        
        self.state = "closed"  # closed, open, half-open
        self.failure_count = 0
        self.last_state_change = time.time()
        self.last_failure_time = 0.0

    def get_status(self) -> dict:
        """Exposes telemetry for dashboard tracking."""
        # Check half-open recovery condition
        if self.state == "open" and (time.time() - self.last_state_change) > self.recovery_timeout_seconds:
            self._transition_to("half-open")
            
        return {
            "state": self.state,
            "failure_count": self.failure_count,
            "failure_threshold": self.failure_threshold,
            "seconds_since_state_change": round(time.time() - self.last_state_change, 1),
            "recovery_timeout_seconds": self.recovery_timeout_seconds
        }

    def _transition_to(self, new_state: str):
        old_state = self.state
        self.state = new_state
        self.last_state_change = time.time()
        logger.warning(
            "CircuitBreaker: State transitioned from %s to %s (failures=%d)",
            old_state.upper(), new_state.upper(), self.failure_count
        )

    def record_success(self):
        self.failure_count = 0
        if self.state in ("open", "half-open"):
            self._transition_to("closed")

    def record_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()
        logger.error("CircuitBreaker: Recorded failure #%d", self.failure_count)
        
        if self.state in ("closed", "half-open") and self.failure_count >= self.failure_threshold:
            self._transition_to("open")

    async def call(self, async_func: Callable, *args, **kwargs) -> Any:
        """Executes an async function, wrapping it with the circuit breaker logic."""
        status = self.get_status()
        
        if status["state"] == "open":
            logger.error("CircuitBreaker: Tripped to OPEN. Blocking remote call instantly.")
            raise CircuitBreakerOpenException("Circuit breaker is open. Bypassing Fireworks AI API.")
            
        try:
            result = await async_func(*args, **kwargs)
            # If the result specifies that AI was not available or had a fallback, count as failure
            if isinstance(result, dict) and not result.get("ai_available", True):
                self.record_failure()
            else:
                self.record_success()
            return result
        except Exception as exc:
            self.record_failure()
            raise exc

# Global instance for tracking the Fireworks AI API connection
fireworks_circuit_breaker = CircuitBreaker(failure_threshold=3, recovery_timeout_seconds=30.0)
