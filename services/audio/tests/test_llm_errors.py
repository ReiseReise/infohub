import unittest

from app.services.llm_errors import LLMUpstreamError, llm_error_response


class LLMErrorTests(unittest.TestCase):
    def test_disconnect_and_timeout_preserve_retry_semantics_without_private_payloads(self):
        transport = type("TransportError", (Exception,), {})
        disconnected = type("RemoteProtocolError", (transport,), {})
        for error, status, code in [
            (disconnected("private prompt and credentials"), 503, "upstream_connection_error"),
            (TimeoutError("private endpoint"), 504, "upstream_timeout"),
            (LLMUpstreamError(429), 429, "upstream_rate_limited"),
            (LLMUpstreamError(502), 503, "upstream_unavailable"),
        ]:
            result_status, detail = llm_error_response(error)
            self.assertEqual(result_status, status)
            self.assertEqual(detail["code"], code)
            self.assertTrue(detail["retryable"])
            self.assertNotIn("private", str(detail))

    def test_configuration_failure_does_not_trigger_transient_retry(self):
        status, detail = llm_error_response(LLMUpstreamError(401))
        self.assertEqual(status, 422)
        self.assertEqual(detail["providerStatus"], 401)
        self.assertFalse(detail["retryable"])
        self.assertIsNone(llm_error_response(ValueError("internal programming error")))
