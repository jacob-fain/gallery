"""Tests for deploy/host/gallery-deploy-poll. Run: python3 -m unittest deploy/test_poll.py"""
import datetime
import importlib.machinery
import importlib.util
import os
import subprocess
import tempfile
import unittest

_path = os.path.join(os.path.dirname(__file__), "host", "gallery-deploy-poll")
_loader = importlib.machinery.SourceFileLoader("poll", _path)
_spec = importlib.util.spec_from_loader("poll", _loader)
poll = importlib.util.module_from_spec(_spec)
_loader.exec_module(poll)

DIGEST_A = "sha256:" + "a" * 64
DIGEST_B = "sha256:" + "b" * 64


class FakeApi:
    def __init__(self, deployments, statuses=None, list_status=200):
        self.deployments = deployments
        self.statuses = statuses or []
        self.list_status = list_status
        self.posted = []

    def request(self, method, url, body=None, etag=None):
        if method == "POST":
            self.posted.append(body)
            return 201, {}, None
        if "/deployments?" in url:
            if self.list_status == 304:
                return 304, None, etag
            return 200, self.deployments, '"etag-1"'
        return 200, self.statuses, None


def deployment(payload=None):
    return {
        "id": 7,
        "ref": "v1.3.0",
        "statuses_url": "https://api.github.com/x/statuses",
        "payload": payload if payload is not None else {"frontend_digest": DIGEST_A, "backend_digest": DIGEST_B},
    }


def fake_run(returncode, stdout):
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, returncode, stdout=stdout, stderr="")

    run.calls = calls
    return run


class HandleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        poll.STATE_DIR = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_applies_a_new_deployment_and_reports_success(self):
        api, run = FakeApi([deployment()]), fake_run(0, "pulling\ndeployed build 0123456789abcdef\n")
        poll.handle(api, "production", run=run)
        self.assertEqual(run.calls[0][-3:], ["prod", DIGEST_A, DIGEST_B])
        self.assertEqual([p["state"] for p in api.posted], ["in_progress", "success"])
        self.assertEqual(api.posted[-1]["description"], "deployed build 0123456789abcdef")
        self.assertEqual(poll.read_etag("production"), '"etag-1"')

    def test_maps_staging_to_the_staging_argument(self):
        api, run = FakeApi([deployment()]), fake_run(0, "ok")
        poll.handle(api, "staging", run=run)
        self.assertEqual(run.calls[0][-3], "staging")

    def test_does_nothing_when_github_answers_304(self):
        api, run = FakeApi([], list_status=304), fake_run(0, "ok")
        self.assertEqual(poll.handle(api, "production", run=run), "nothing new")
        self.assertEqual(run.calls, [])

    def test_skips_a_deployment_that_already_has_a_final_status(self):
        api, run = FakeApi([deployment()], statuses=[{"state": "success", "created_at": "2026-01-01T00:00:00Z"}]), fake_run(0, "ok")
        poll.handle(api, "production", run=run)
        self.assertEqual(run.calls, [])
        self.assertEqual(api.posted, [])

    def test_refuses_a_payload_without_valid_digests(self):
        for payload in ({}, {"frontend_digest": "latest", "backend_digest": DIGEST_B}, "not json"):
            api, run = FakeApi([deployment(payload)]), fake_run(0, "ok")
            poll.handle(api, "production", run=run)
            self.assertEqual(run.calls, [], payload)
            self.assertEqual(api.posted[-1]["state"], "error")

    def test_leaves_a_busy_deployment_queued_for_the_next_run(self):
        api, run = FakeApi([deployment()]), fake_run(poll.EXIT_BUSY, "busy: another gallery job holds the lock")
        poll.handle(api, "production", run=run)
        self.assertEqual(api.posted[-1]["state"], "queued")
        self.assertIsNone(poll.read_etag("production"))

    def test_reports_failure_and_notifies_only_for_production(self):
        notified = []
        poll.notify = lambda title, message: notified.append(message)
        for env in ("production", "staging"):
            api, run = FakeApi([deployment()]), fake_run(1, "migrations failed; the running release is unchanged")
            poll.handle(api, env, run=run)
            self.assertEqual(api.posted[-1]["state"], "failure")
        self.assertEqual(len(notified), 1)
        self.assertIn("migrations failed", notified[0])


class StaleInProgressTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        poll.STATE_DIR = self.tmp.name
        self.real_now = poll.now

    def tearDown(self):
        poll.now = self.real_now
        self.tmp.cleanup()

    def test_a_dead_pollers_in_progress_is_retried_once_stale(self):
        started = datetime.datetime(2026, 11, 24, 12, 0, tzinfo=datetime.timezone.utc)
        status = [{"state": "in_progress", "created_at": "2026-11-24T12:00:00Z"}]

        # Shortly after: left alone, and the ETag is not saved.
        poll.now = lambda: started + datetime.timedelta(minutes=5)
        api, run = FakeApi([deployment()], statuses=status), fake_run(0, "ok")
        poll.handle(api, "production", run=run)
        self.assertEqual(run.calls, [])
        self.assertIsNone(poll.read_etag("production"))

        # Past the stale limit: the next poll still sees the list and applies.
        poll.now = lambda: started + datetime.timedelta(minutes=31)
        api, run = FakeApi([deployment()], statuses=status), fake_run(0, "deployed build x")
        poll.handle(api, "production", run=run)
        self.assertEqual(len(run.calls), 1)
        self.assertEqual(api.posted[-1]["state"], "success")


class RetryableTests(unittest.TestCase):
    at = datetime.datetime(2026, 11, 24, 12, 0, tzinfo=datetime.timezone.utc)

    def test_queued_and_pending_are_retried(self):
        for state in ("queued", "pending"):
            self.assertTrue(poll.retryable({"state": state, "created_at": "2026-11-24T11:59:00Z"}, self.at))

    def test_recent_in_progress_is_left_alone_and_stale_is_retried(self):
        self.assertFalse(poll.retryable({"state": "in_progress", "created_at": "2026-11-24T11:50:00Z"}, self.at))
        self.assertTrue(poll.retryable({"state": "in_progress", "created_at": "2026-11-24T11:00:00Z"}, self.at))

    def test_final_states_are_not_retried(self):
        for state in ("success", "failure", "error", "inactive"):
            self.assertFalse(poll.retryable({"state": state, "created_at": "2026-01-01T00:00:00Z"}, self.at))


if __name__ == "__main__":
    unittest.main()
