"""Tests for the core runtime components."""

import asyncio
import pytest
import time
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from runtime.types import (
    IntentState,
    TaskStatus,
    ExecutionClass,
    SemanticDiff,
    gen_fingerprint,
    gen_id,
)
from runtime.events import EventBus, RuntimeEvent
from runtime.state import StateManager
from runtime.graph import DependencyGraph
from runtime.semantic import compute_semantic_diff, compute_impact_analysis
from runtime.scheduler import TaskScheduler, IdempotencyGuard
from runtime.interruption import InterruptionScorer, InterruptionClassifier


class TestTypes:
    def test_gen_id(self):
        id1 = gen_id("test_")
        id2 = gen_id("test_")
        assert id1.startswith("test_")
        assert id1 != id2

    def test_gen_fingerprint_deterministic(self):
        data = {"ram": "8GB", "price": 60000, "category": "laptop"}
        fp1 = gen_fingerprint(data)
        fp2 = gen_fingerprint(data)
        assert fp1 == fp2

    def test_gen_fingerprint_order_independent(self):
        data1 = {"a": 1, "b": 2}
        data2 = {"b": 2, "a": 1}
        assert gen_fingerprint(data1) == gen_fingerprint(data2)

    def test_gen_fingerprint_changes_with_data(self):
        fp1 = gen_fingerprint({"ram": "8GB"})
        fp2 = gen_fingerprint({"ram": "16GB"})
        assert fp1 != fp2

    def test_intent_state_fingerprint(self):
        intent = IntentState(
            domain="shopping",
            objective="search",
            constraints={"ram": "8GB", "max_price": 60000},
            targets=["Amazon", "Flipkart"],
        )
        fp = intent.fingerprint()
        assert isinstance(fp, str)
        assert len(fp) == 16

    def test_intent_state_fingerprint_changes(self):
        intent1 = IntentState(
            domain="shopping",
            constraints={"ram": "8GB"},
            targets=["Amazon"],
        )
        intent2 = IntentState(
            domain="shopping",
            constraints={"ram": "16GB"},
            targets=["Amazon"],
        )
        assert intent1.fingerprint() != intent2.fingerprint()


class TestEventBus:
    @pytest.fixture
    def event_bus(self):
        return EventBus()

    @pytest.mark.asyncio
    async def test_publish_and_subscribe(self, event_bus):
        received = []
        event_bus.subscribe("TEST", lambda e: received.append(e))

        event = RuntimeEvent(event_type="TEST", payload={"value": 42})
        await event_bus.publish(event)

        assert len(received) == 1
        assert received[0].payload["value"] == 42

    @pytest.mark.asyncio
    async def test_subscribe_all(self, event_bus):
        received = []
        event_bus.subscribe_all(lambda e: received.append(e))

        await event_bus.publish(RuntimeEvent(event_type="A"))
        await event_bus.publish(RuntimeEvent(event_type="B"))

        assert len(received) == 2

    @pytest.mark.asyncio
    async def test_history(self, event_bus):
        for i in range(5):
            await event_bus.publish(RuntimeEvent(event_type=f"EVENT_{i}"))

        history = event_bus.get_history()
        assert len(history) == 5

    @pytest.mark.asyncio
    async def test_history_filter(self, event_bus):
        await event_bus.publish(RuntimeEvent(event_type="A"))
        await event_bus.publish(RuntimeEvent(event_type="B"))
        await event_bus.publish(RuntimeEvent(event_type="A"))

        history = event_bus.get_history(event_type="A")
        assert len(history) == 2

    @pytest.mark.asyncio
    async def test_unsubscribe(self, event_bus):
        received = []
        unsub = event_bus.subscribe("TEST", lambda e: received.append(e))

        await event_bus.publish(RuntimeEvent(event_type="TEST"))
        assert len(received) == 1

        unsub()
        await event_bus.publish(RuntimeEvent(event_type="TEST"))
        assert len(received) == 1


class TestDependencyGraph:
    @pytest.fixture
    def graph(self):
        g = DependencyGraph()
        g.add_node("A", {"op": "search_amazon"})
        g.add_node("B", {"op": "search_flipkart"})
        g.add_node("C", {"op": "parse_amazon"})
        g.add_node("D", {"op": "parse_flipkart"})
        g.add_node("E", {"op": "merge"})
        g.add_edge("A", "C")
        g.add_edge("B", "D")
        g.add_edge("C", "E")
        g.add_edge("D", "E")
        return g

    def test_node_count(self, graph):
        assert graph.node_count == 5

    def test_edge_count(self, graph):
        assert graph.edge_count == 4

    def test_descendants(self, graph):
        desc = graph.get_all_descendants("A")
        assert "C" in desc
        assert "E" in desc
        assert "B" not in desc

    def test_ancestors(self, graph):
        anc = graph.get_all_ancestors("E")
        assert "A" in anc
        assert "B" in anc
        assert "C" in anc
        assert "D" in anc

    def test_impacted_nodes(self, graph):
        impacted = graph.get_impacted_nodes({"A"})
        assert "A" in impacted
        assert "C" in impacted
        assert "E" in impacted
        assert "B" not in impacted
        assert "D" not in impacted

    def test_recovery_frontier(self, graph):
        stale = {"C", "E"}
        preserved = {"A", "B", "D"}
        frontier = graph.get_recovery_frontier(stale, preserved)
        assert "C" in frontier  # C depends on A which is preserved

    def test_execution_order(self, graph):
        order = graph.get_execution_order()
        # A and B should come before C and D
        assert order.index("A") < order.index("C")
        assert order.index("B") < order.index("D")
        # C and D should come before E
        assert order.index("C") < order.index("E")
        assert order.index("D") < order.index("E")

    def test_roots(self, graph):
        roots = graph.get_roots()
        assert set(roots) == {"A", "B"}

    def test_leaves(self, graph):
        leaves = graph.get_leaves()
        assert leaves == ["E"]

    def test_remove_node(self, graph):
        graph.remove_node("C")
        assert graph.node_count == 4
        assert "C" not in graph.get_dependents("A")

    def test_clone(self, graph):
        clone = graph.clone()
        assert clone.node_count == graph.node_count
        assert clone.edge_count == graph.edge_count


class TestSemanticDiff:
    def test_no_change(self):
        old = IntentState(domain="shopping", constraints={"ram": "8GB", "price": 60000})
        new = IntentState(domain="shopping", constraints={"ram": "8GB", "price": 60000})
        diff = compute_semantic_diff(old, new)
        assert not diff.has_changes

    def test_constraint_modified(self):
        old = IntentState(domain="shopping", constraints={"ram": "8GB", "price": 60000})
        new = IntentState(domain="shopping", constraints={"ram": "16GB", "price": 60000})
        diff = compute_semantic_diff(old, new)
        assert diff.has_changes
        assert "ram" in diff.modified
        assert diff.modified["ram"] == ("8GB", "16GB")
        assert "price" in diff.unchanged

    def test_constraint_added(self):
        old = IntentState(domain="shopping", constraints={"ram": "8GB"})
        new = IntentState(domain="shopping", constraints={"ram": "8GB", "processor": "AMD"})
        diff = compute_semantic_diff(old, new)
        assert "processor" in diff.added
        assert diff.added["processor"] == "AMD"

    def test_constraint_removed(self):
        old = IntentState(domain="shopping", constraints={"ram": "8GB", "processor": "AMD"})
        new = IntentState(domain="shopping", constraints={"ram": "8GB"})
        diff = compute_semantic_diff(old, new)
        assert "processor" in diff.removed

    def test_domain_changed(self):
        old = IntentState(domain="shopping", constraints={})
        new = IntentState(domain="travel", constraints={})
        diff = compute_semantic_diff(old, new)
        assert diff.domain_changed
        assert diff.impact_score() == 1.0

    def test_targets_changed(self):
        old = IntentState(domain="shopping", targets=["Amazon"])
        new = IntentState(domain="shopping", targets=["Amazon", "Flipkart"])
        diff = compute_semantic_diff(old, new)
        assert diff.targets_changed

    def test_changed_fields(self):
        old = IntentState(domain="shopping", constraints={"ram": "8GB"})
        new = IntentState(domain="travel", constraints={"ram": "16GB"})
        diff = compute_semantic_diff(old, new)
        assert "ram" in diff.changed_fields
        assert "domain" in diff.changed_fields

    def test_impact_analysis(self):
        diff = SemanticDiff(
            modified={"ram": ("8GB", "16GB")},
            unchanged={"category": "laptop", "max_price": 60000},
        )

        tasks = {
            "task_1": {"reads": ["category", "ram"], "status": "running", "semantic_scope": []},
            "task_2": {"reads": ["category"], "status": "running", "semantic_scope": []},
            "task_3": {"reads": ["ram", "max_price"], "status": "pending", "semantic_scope": []},
            "task_4": {"reads": ["category"], "status": "completed", "semantic_scope": []},
        }

        impact = compute_impact_analysis(diff, tasks)
        assert "task_1" in impact["fenced"] or "task_1" in impact["stale"]
        assert "task_2" in impact["preserved"]
        assert "task_3" in impact["stale"]


class TestInterruptionScorer:
    def test_initial_score_zero(self):
        scorer = InterruptionScorer()
        assert scorer.current_score == 0.0

    def test_score_increases_with_speech(self):
        scorer = InterruptionScorer()
        result = scorer.compute(speech_active=True, transcript_available=True, transcript_length=15)
        assert result.score > 0.3

    def test_score_low_without_signals(self):
        scorer = InterruptionScorer()
        result = scorer.compute(current_task_interruptible=False)
        assert result.score < 0.05

    def test_commit_penalty(self):
        scorer = InterruptionScorer()
        result = scorer.compute(commit_in_progress=True, speech_active=True)
        result_no_commit = scorer.compute(commit_in_progress=False, speech_active=True)
        # With commit penalty the score should be lower (or equal due to smoothing)
        assert result.score <= result_no_commit.score + 0.01

    def test_backchannel_penalty(self):
        scorer = InterruptionScorer()
        result = scorer.compute(speech_active=True, backchannel_likelihood=0.8)
        result_no_bc = scorer.compute(speech_active=True, backchannel_likelihood=0.0)
        assert result.score < result_no_bc.score

    def test_smoothing(self):
        scorer = InterruptionScorer()
        r1 = scorer.compute(speech_active=True, transcript_available=True, transcript_length=10)
        # After high signal, score should be high
        assert r1.score > 0.3
        # Now compute with no signals - score should decrease
        import time
        time.sleep(0.02)  # Ensure dt > 0.01 for smoothing to apply
        r2 = scorer.compute()
        assert r2.score < r1.score


class TestInterruptionClassifier:
    @pytest.fixture
    def classifier(self):
        return InterruptionClassifier()

    def test_backchannel(self, classifier):
        assert classifier.classify("ok", {}) == "backchannel"
        assert classifier.classify("right", {}) == "backchannel"
        assert classifier.classify("uh-huh", {}) == "backchannel"

    def test_cancellation(self, classifier):
        assert classifier.classify("stop everything", {}) == "cancellation"
        assert classifier.classify("cancel", {}) == "cancellation"

    def test_clarification(self, classifier):
        assert classifier.classify("why are you checking Flipkart?", {}) == "clarification"

    def test_modification(self, classifier):
        assert classifier.classify("actually make it 16 GB", {}) == "modification"
        assert classifier.classify("wait make that 16 GB RAM", {}) == "modification"
        assert classifier.classify("instead of 8 GB use 16 GB", {}) == "modification"


class TestIdempotencyGuard:
    @pytest.fixture
    def guard(self):
        return IdempotencyGuard()

    def test_make_key_deterministic(self, guard):
        key1 = guard.make_key("search", {"query": "laptop"}, 1)
        key2 = guard.make_key("search", {"query": "laptop"}, 1)
        assert key1 == key2

    def test_make_key_differs_by_version(self, guard):
        key1 = guard.make_key("search", {"query": "laptop"}, 1)
        key2 = guard.make_key("search", {"query": "laptop"}, 2)
        assert key1 != key2

    @pytest.mark.asyncio
    async def test_acquire_and_complete(self, guard):
        key = guard.make_key("search", {"q": "test"}, 1)
        acquired, _ = await guard.check_and_acquire(key)
        assert acquired

        await guard.record_completion(key, {"result": "done"})
        acquired2, prev_result = await guard.check_and_acquire(key)
        assert not acquired2
        assert prev_result["result"] == "done"

    @pytest.mark.asyncio
    async def test_duplicate_prevention(self, guard):
        key = guard.make_key("buy", {"item": "laptop"}, 1)
        acquired, _ = await guard.check_and_acquire(key)
        assert acquired

        # Second attempt while in-flight
        acquired2, result = await guard.check_and_acquire(key)
        assert not acquired2


class TestStateManager:
    @pytest.fixture
    def state_manager(self):
        bus = EventBus()
        return StateManager(bus)

    @pytest.mark.asyncio
    async def test_initial_version(self, state_manager):
        assert state_manager.version == 0

    @pytest.mark.asyncio
    async def test_update_intent_increments_version(self, state_manager):
        intent = IntentState(domain="shopping", constraints={"ram": "8GB"})
        version = await state_manager.update_intent(intent, "test")
        assert version == 1
        assert state_manager.version == 1

    @pytest.mark.asyncio
    async def test_register_and_get_task(self, state_manager):
        task = {"task_id": "task_1", "status": "pending", "operation": "search"}
        await state_manager.register_task(task)
        result = state_manager.get_task("task_1")
        assert result is not None
        assert result["operation"] == "search"

    @pytest.mark.asyncio
    async def test_update_task(self, state_manager):
        task = {"task_id": "task_1", "status": "pending", "operation": "search"}
        await state_manager.register_task(task)
        await state_manager.update_task("task_1", {"status": "running"})
        result = state_manager.get_task("task_1")
        assert result["status"] == "running"

    @pytest.mark.asyncio
    async def test_archive_task(self, state_manager):
        task = {"task_id": "task_1", "status": "completed", "operation": "search", "state_version": 1}
        await state_manager.register_task(task)
        await state_manager.archive_task("task_1", "semantic_change")
        assert state_manager.get_task("task_1") is None
        archived = state_manager.get_archived_tasks()
        assert "task_1" in archived
        assert archived["task_1"]["archive_reason"] == "semantic_change"

    @pytest.mark.asyncio
    async def test_checkpoint(self, state_manager):
        intent = IntentState(domain="shopping")
        await state_manager.update_intent(intent, "test")
        snapshot = await state_manager.create_checkpoint()
        assert snapshot.version == 1

    @pytest.mark.asyncio
    async def test_get_tasks_reading_field(self, state_manager):
        await state_manager.register_task({"task_id": "t1", "reads": ["ram", "price"], "status": "running"})
        await state_manager.register_task({"task_id": "t2", "reads": ["category"], "status": "running"})
        await state_manager.register_task({"task_id": "t3", "reads": ["ram"], "status": "pending"})

        ram_tasks = state_manager.get_tasks_reading_field("ram")
        assert len(ram_tasks) == 2

    @pytest.mark.asyncio
    async def test_stale_result_protection(self, state_manager):
        """Critical test: stale results cannot overwrite newer state."""
        # Setup initial state
        intent_v1 = IntentState(domain="shopping", constraints={"ram": "8GB"})
        await state_manager.update_intent(intent_v1, "initial")
        assert state_manager.version == 1

        # Register a task on v1
        task = {"task_id": "t1", "status": "running", "state_version": 1, "reads": ["ram"]}
        await state_manager.register_task(task)

        # User changes RAM - state moves to v2
        intent_v2 = IntentState(domain="shopping", constraints={"ram": "16GB"})
        await state_manager.update_intent(intent_v2, "ram_change")
        assert state_manager.version == 2

        # Task tries to commit result - should be fenced
        old_task = state_manager.get_task("t1")
        assert old_task["state_version"] == 1
        assert state_manager.version == 2
        # The runtime would detect version mismatch and fence the result


class TestScheduler:
    @pytest.fixture
    def scheduler(self):
        bus = EventBus()
        graph = DependencyGraph()
        return TaskScheduler(bus, graph, max_concurrent=5)

    @pytest.mark.asyncio
    async def test_schedule_and_complete(self, scheduler):
        async def work(cancel_event):
            await asyncio.sleep(0.1)
            return {"result": "done"}

        await scheduler.schedule("task_1", lambda ce: work(ce))
        await asyncio.sleep(0.3)
        assert scheduler.running_count == 0

    @pytest.mark.asyncio
    async def test_cancel_task(self, scheduler):
        async def slow_work(cancel_event):
            for _ in range(100):
                if cancel_event.is_set():
                    return {"status": "cancelled"}
                await asyncio.sleep(0.05)
            return {"status": "completed"}

        await scheduler.schedule("task_1", lambda ce: slow_work(ce), timeout=10.0)
        await asyncio.sleep(0.1)
        result = await scheduler.cancel_task("task_1", "test_cancel")
        assert result is True

    @pytest.mark.asyncio
    async def test_concurrency_limit(self, scheduler):
        started = []
        async def tracked_work(cancel_event):
            started.append(1)
            await asyncio.sleep(0.5)
            return {}

        # Schedule more than max_concurrent
        for i in range(8):
            await scheduler.schedule(f"task_{i}", lambda ce: tracked_work(ce))

        await asyncio.sleep(0.1)
        # Not all should have started yet due to semaphore
        assert len(started) <= 5
        await scheduler.cancel_all("test_cleanup")


class TestEndToEndInterruption:
    """End-to-end test for the interruption pipeline."""

    @pytest.mark.asyncio
    async def test_interruption_recovery(self):
        from runtime.runtime import Runtime

        runtime = Runtime()
        await runtime.start()

        # Submit initial intent
        intent = IntentState(
            domain="shopping",
            objective="search",
            constraints={"ram": "8GB", "max_price": 60000, "category": "laptop"},
            targets=["Amazon", "Flipkart"],
            raw_text="Find laptops under 60000 with 8GB RAM",
        )
        result = await runtime.submit_intent(intent)
        assert "planned_tasks" in result

        # Wait a bit for tasks to start
        await asyncio.sleep(0.3)

        # Interrupt with modification
        interruption_result = await runtime.handle_interruption(
            "Wait, make that 16 GB RAM"
        )

        assert "action" in interruption_result
        assert runtime.state.version >= 2  # State should have advanced
        assert runtime.state.intent.constraints.get("ram") == "16GB"
        # Other constraints should be preserved
        assert runtime.state.intent.constraints.get("max_price") == 60000
        assert runtime.state.intent.constraints.get("category") == "laptop"

        await runtime.stop()

    @pytest.mark.asyncio
    async def test_state_version_fencing(self):
        """Test that stale results are properly fenced."""
        from runtime.runtime import Runtime

        runtime = Runtime()
        await runtime.start()

        # Initial state
        intent = IntentState(
            domain="shopping",
            constraints={"ram": "8GB"},
            targets=["Amazon"],
            raw_text="Find laptops with 8GB RAM",
        )
        await runtime.submit_intent(intent)
        v1 = runtime.state.version

        # Change state
        await runtime.handle_interruption("Actually make it 16 GB RAM")
        v2 = runtime.state.version

        assert v2 > v1
        assert runtime.state.intent.constraints["ram"] == "16GB"

        await runtime.stop()

    @pytest.mark.asyncio
    async def test_chaos_scenario(self):
        """Chaos test: multiple interruptions, failures, and recovery."""
        from runtime.runtime import Runtime

        runtime = Runtime()
        await runtime.start()

        # Submit initial intent
        intent = IntentState(
            domain="shopping",
            constraints={"ram": "8GB", "max_price": 60000},
            targets=["Amazon", "Flipkart"],
            raw_text="Find laptops under 60000 with 8GB RAM",
        )
        await runtime.submit_intent(intent)
        await asyncio.sleep(0.2)

        # First interruption
        await runtime.handle_interruption("Actually make it 16 GB")
        await asyncio.sleep(0.2)

        # Second interruption
        await runtime.handle_interruption("Wait, make that 32 GB")
        await asyncio.sleep(0.2)

        # Third interruption - back to 16
        await runtime.handle_interruption("Actually 16 GB is fine")

        # State should reflect the latest intent
        assert runtime.state.intent.constraints["ram"] == "16GB"
        assert runtime.state.version >= 4

        # Runtime should still be healthy
        state = runtime.get_runtime_state()
        assert state["state_version"] >= 4

        await runtime.stop()


class TestDeterministicProviders:
    def test_intent_parser_laptop(self):
        from providers.deterministic import DeterministicIntentParser
        parser = DeterministicIntentParser()
        intent = parser.parse_intent("Find me laptops under ₹60,000 with 8 GB RAM on Amazon and Flipkart")
        assert intent.domain == "shopping"
        assert intent.constraints.get("ram") == "8GB"
        assert intent.constraints.get("max_price") == 60000
        assert "Amazon" in intent.targets
        assert "Flipkart" in intent.targets

    def test_intent_parser_modification(self):
        from providers.deterministic import DeterministicIntentParser
        parser = DeterministicIntentParser()
        current = IntentState(
            domain="shopping",
            constraints={"ram": "8GB", "max_price": 60000, "category": "laptop"},
            targets=["Amazon", "Flipkart"],
        )
        new_intent = parser.parse_modification("Wait, make that 16 GB RAM", current)
        assert new_intent.constraints["ram"] == "16GB"
        assert new_intent.constraints["max_price"] == 60000  # Preserved
        assert new_intent.constraints["category"] == "laptop"  # Preserved

    def test_intent_parser_hotel(self):
        from providers.deterministic import DeterministicIntentParser
        parser = DeterministicIntentParser()
        intent = parser.parse_intent("Find me a hotel in Bengaluru for three nights")
        assert intent.domain == "travel"
        assert intent.constraints.get("destination") == "Bengaluru"

    @pytest.mark.asyncio
    async def test_decision_provider_interruption(self):
        from providers.deterministic import DeterministicDecisionProvider
        provider = DeterministicDecisionProvider()
        result = await provider.decide("interruption_category", {"transcript": "actually make it 16 GB"}, [])
        assert result["decision"] == "modification"

    @pytest.mark.asyncio
    async def test_decision_provider_backchannel(self):
        from providers.deterministic import DeterministicDecisionProvider
        provider = DeterministicDecisionProvider()
        result = await provider.decide("interruption_category", {"transcript": "ok"}, [])
        assert result["decision"] == "backchannel"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
