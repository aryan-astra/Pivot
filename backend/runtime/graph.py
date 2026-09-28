"""Dependency graph with traversal, invalidation, and recovery frontier."""

from __future__ import annotations

from collections import deque
from typing import Any, Optional


class DependencyGraph:
    """DAG for task dependencies with traversal and impact analysis."""

    def __init__(self):
        self._nodes: dict[str, dict[str, Any]] = {}
        self._edges_forward: dict[str, set[str]] = {}  # task -> dependents
        self._edges_backward: dict[str, set[str]] = {}  # task -> dependencies

    def add_node(self, task_id: str, metadata: Optional[dict[str, Any]] = None) -> None:
        self._nodes[task_id] = metadata or {}
        if task_id not in self._edges_forward:
            self._edges_forward[task_id] = set()
        if task_id not in self._edges_backward:
            self._edges_backward[task_id] = set()

    def add_edge(self, from_id: str, to_id: str) -> None:
        if from_id not in self._nodes:
            self.add_node(from_id)
        if to_id not in self._nodes:
            self.add_node(to_id)
        self._edges_forward[from_id].add(to_id)
        self._edges_backward[to_id].add(from_id)

    def remove_node(self, task_id: str) -> None:
        if task_id in self._edges_forward:
            for dep in self._edges_forward[task_id]:
                self._edges_backward.get(dep, set()).discard(task_id)
            del self._edges_forward[task_id]
        if task_id in self._edges_backward:
            for parent in self._edges_backward[task_id]:
                self._edges_forward.get(parent, set()).discard(task_id)
            del self._edges_backward[task_id]
        self._nodes.pop(task_id, None)

    def get_node(self, task_id: str) -> Optional[dict[str, Any]]:
        return self._nodes.get(task_id)

    def get_dependents(self, task_id: str) -> set[str]:
        return set(self._edges_forward.get(task_id, set()))

    def get_dependencies(self, task_id: str) -> set[str]:
        return set(self._edges_backward.get(task_id, set()))

    def get_all_descendants(self, task_id: str) -> set[str]:
        """BFS to get all downstream dependents."""
        visited = set()
        queue = deque([task_id])
        while queue:
            current = queue.popleft()
            for dep in self._edges_forward.get(current, set()):
                if dep not in visited:
                    visited.add(dep)
                    queue.append(dep)
        return visited

    def get_all_ancestors(self, task_id: str) -> set[str]:
        """BFS to get all upstream dependencies."""
        visited = set()
        queue = deque([task_id])
        while queue:
            current = queue.popleft()
            for dep in self._edges_backward.get(current, set()):
                if dep not in visited:
                    visited.add(dep)
                    queue.append(dep)
        return visited

    def get_impacted_nodes(self, changed_task_ids: set[str]) -> set[str]:
        """Get all nodes affected by changes to the given tasks."""
        impacted = set(changed_task_ids)
        for task_id in changed_task_ids:
            impacted |= self.get_all_descendants(task_id)
        return impacted

    def get_recovery_frontier(self, stale_task_ids: set[str],
                              preserved_task_ids: set[str]) -> list[str]:
        """Find the earliest nodes where recovery must begin.
        
        The recovery frontier is the set of stale nodes whose
        dependencies are all preserved or completed.
        """
        frontier = []
        for task_id in stale_task_ids:
            deps = self._edges_backward.get(task_id, set())
            if not deps or deps.issubset(preserved_task_ids):
                frontier.append(task_id)
        return frontier

    def get_preserved_subgraph(self, preserved_ids: set[str]) -> dict[str, set[str]]:
        """Get the subgraph of preserved nodes and their edges."""
        subgraph: dict[str, set[str]] = {}
        for node_id in preserved_ids:
            edges = self._edges_forward.get(node_id, set()) & preserved_ids
            if edges:
                subgraph[node_id] = edges
        return subgraph

    def get_execution_order(self, task_ids: Optional[set[str]] = None) -> list[str]:
        """Topological sort for execution ordering."""
        if task_ids is None:
            task_ids = set(self._nodes.keys())

        in_degree: dict[str, int] = {tid: 0 for tid in task_ids}
        for tid in task_ids:
            for dep in self._edges_backward.get(tid, set()):
                if dep in task_ids:
                    in_degree[tid] += 1

        queue = deque([tid for tid, deg in in_degree.items() if deg == 0])
        result = []

        while queue:
            current = queue.popleft()
            result.append(current)
            for dep in self._edges_forward.get(current, set()):
                if dep in in_degree:
                    in_degree[dep] -= 1
                    if in_degree[dep] == 0:
                        queue.append(dep)

        return result

    def get_roots(self) -> list[str]:
        """Get nodes with no dependencies."""
        return [
            tid for tid in self._nodes
            if not self._edges_backward.get(tid, set())
        ]

    def get_leaves(self) -> list[str]:
        """Get nodes with no dependents."""
        return [
            tid for tid in self._nodes
            if not self._edges_forward.get(tid, set())
        ]

    @property
    def node_count(self) -> int:
        return len(self._nodes)

    @property
    def edge_count(self) -> int:
        return sum(len(edges) for edges in self._edges_forward.values())

    def to_dict(self) -> dict[str, Any]:
        return {
            "nodes": {
                tid: {**meta, "dependents": list(self._edges_forward.get(tid, set())),
                      "dependencies": list(self._edges_backward.get(tid, set()))}
                for tid, meta in self._nodes.items()
            },
            "node_count": self.node_count,
            "edge_count": self.edge_count,
        }

    def clone(self) -> "DependencyGraph":
        new_graph = DependencyGraph()
        for tid, meta in self._nodes.items():
            new_graph.add_node(tid, dict(meta))
        for from_id, to_ids in self._edges_forward.items():
            for to_id in to_ids:
                new_graph.add_edge(from_id, to_id)
        return new_graph
