"""Semantic diff engine for comparing intent states."""

from __future__ import annotations

from typing import Any

from .types import IntentState, SemanticDiff


def compute_semantic_diff(old_state: IntentState, new_state: IntentState) -> SemanticDiff:
    """Compare two intent states and produce a structured diff."""
    diff = SemanticDiff()

    old_constraints = old_state.constraints
    new_constraints = new_state.constraints

    all_keys = set(old_constraints.keys()) | set(new_constraints.keys())

    for key in all_keys:
        if key in old_constraints and key not in new_constraints:
            diff.removed[key] = old_constraints[key]
        elif key not in old_constraints and key in new_constraints:
            diff.added[key] = new_constraints[key]
        elif old_constraints[key] != new_constraints[key]:
            diff.modified[key] = (old_constraints[key], new_constraints[key])
        else:
            diff.unchanged[key] = old_constraints[key]

    if old_state.domain != new_state.domain:
        diff.domain_changed = True

    if old_state.objective != new_state.objective:
        diff.objective_changed = True

    old_targets = sorted(old_state.targets)
    new_targets = sorted(new_state.targets)
    if old_targets != new_targets:
        diff.targets_changed = True
        diff.old_targets = old_state.targets
        diff.new_targets = new_state.targets

    return diff


def compute_impact_analysis(
    diff: SemanticDiff,
    tasks: dict[str, dict[str, Any]],
) -> dict[str, list[str]]:
    """Determine which tasks are affected by the semantic diff.
    
    Returns:
        {
            "stale": [task_ids that must be recomputed],
            "preserved": [task_ids that remain valid],
            "fenced": [task_ids that need fencing],
        }
    """
    changed_fields = diff.changed_fields
    result: dict[str, list[str]] = {"stale": [], "preserved": [], "fenced": []}

    for task_id, task in tasks.items():
        if task.get("status") in ("completed", "archived"):
            result["preserved"].append(task_id)
            continue

        reads = set(task.get("reads", []))
        semantic_scope = set(task.get("semantic_scope", []))
        relevant_fields = reads | semantic_scope

        affected = relevant_fields & changed_fields

        if affected:
            status = task.get("status", "")
            if status == "running":
                result["fenced"].append(task_id)
            elif status in ("pending", "running"):
                result["stale"].append(task_id)
            else:
                result["stale"].append(task_id)
        else:
            if task.get("status") in ("pending", "running"):
                result["preserved"].append(task_id)
            elif task.get("status") == "completed":
                result["preserved"].append(task_id)

    return result


def validate_result_fingerprint(
    task_reads: list[str],
    task_fingerprint: str,
    current_intent: IntentState,
) -> bool:
    """Check if a task result is still valid against current state."""
    current_values = {
        k: current_intent.constraints.get(k)
        for k in task_reads
    }
    current_values["domain"] = current_intent.domain
    current_values["objective"] = current_intent.objective

    from .types import gen_fingerprint
    current_fp = gen_fingerprint(current_values)
    return current_fp == task_fingerprint
