import networkx as nx
import pytest
from fastapi import HTTPException

from app.main import (
    Coordinates,
    RouteRequest,
    compute_routes,
    dijkstra_shortest_path,
    haversine_meters,
    normalize_mode,
    path_cost,
    yen_k_shortest_paths,
)


def test_haversine_distance_is_positive_and_reasonable():
    distance = haversine_meters(28.6139, 77.209, 28.6562, 77.241)
    assert distance > 0
    assert distance < 20000


def test_mode_normalization_supports_common_aliases():
    assert normalize_mode("driving") == "drive"
    assert normalize_mode("bike") == "bike"
    assert normalize_mode("walk") == "walk"


def test_yen_k_shortest_paths_returns_ordered_routes():
    graph = nx.DiGraph()
    graph.add_weighted_edges_from(
        [
            ("A", "B", 3),
            ("A", "C", 6),
            ("B", "D", 2),
            ("C", "D", 1),
            ("D", "E", 2),
            ("B", "E", 10),
            ("C", "E", 4),
            ("E", "F", 1),
        ]
    )
    for u, v, weight in list(graph.edges(data='weight')):
        graph[u][v]['length'] = weight

    routes = yen_k_shortest_paths(graph, "A", "F", 3)
    assert len(routes) >= 2
    assert routes[0] == ["A", "B", "D", "E", "F"]
    assert path_cost(graph, routes[0]) == 8


def test_yen_routes_use_shortest_parallel_osm_edge():
    graph = nx.MultiDiGraph()
    graph.add_edge("A", "B", length=7)
    graph.add_edge("A", "B", length=2)
    graph.add_edge("B", "C", length=3)
    graph.add_edge("A", "C", length=8)

    routes = yen_k_shortest_paths(graph, "A", "C", 2)

    assert routes == [["A", "B", "C"], ["A", "C"]]
    assert path_cost(graph, routes[0]) == 5


def test_dijkstra_returns_minimum_distance_path_and_exploration_steps():
    graph = nx.MultiDiGraph()
    graph.add_edge("A", "B", length=4)
    graph.add_edge("B", "D", length=3)
    graph.add_edge("A", "C", length=2)
    graph.add_edge("C", "D", length=9)

    route, steps = dijkstra_shortest_path(graph, "A", "D")

    assert route == ["A", "B", "D"]
    assert path_cost(graph, route) == 7
    assert steps[-1]["node_id"] == "D"


def test_compute_routes_uses_dijkstra_as_primary_without_generating_alternatives(monkeypatch):
    from app import main

    graph = nx.MultiDiGraph()
    graph.add_node("A", y=17.0, x=78.0)
    graph.add_node("B", y=17.1, x=78.1)
    graph.add_node("C", y=17.2, x=78.2)
    graph.add_edge("A", "B", length=2)
    graph.add_edge("B", "C", length=3)
    graph.add_edge("A", "C", length=9)
    nearest_nodes = iter(("A", "C"))
    monkeypatch.setattr(main, "overpass_has_capacity", lambda: True)
    monkeypatch.setattr(main, "get_graph_for_points", lambda *args, **kwargs: graph)
    monkeypatch.setattr(main.ox, "nearest_nodes", lambda *args, **kwargs: next(nearest_nodes))
    monkeypatch.setattr(main, "yen_k_shortest_paths", lambda *args: (_ for _ in ()).throw(AssertionError()))

    result = compute_routes(
        RouteRequest(
            source=Coordinates(lat=17.0, lon=78.0),
            destination=Coordinates(lat=17.2, lon=78.2),
            alternatives=1,
        )
    )

    assert result["shortest_route"]["distance_meters"] == 5
    assert result["shortest_route"]["coordinates"] == [(17.0, 78.0), (17.1, 78.1), (17.2, 78.2)]


def test_compute_routes_falls_back_when_osm_is_unavailable(monkeypatch):
    from app import main

    def fail_to_load_graph(*args, **kwargs):
        raise main.requests.exceptions.ConnectionError("Overpass unavailable")

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "code": "Ok",
                "routes": [{
                    "distance": 19306.5,
                    "duration": 1503.1,
                    "geometry": {"coordinates": [[78.4747, 17.3616], [78.3772, 17.4435]]},
                }],
            }

    monkeypatch.setattr(main, "get_graph_for_points", fail_to_load_graph)
    monkeypatch.setattr(main, "overpass_has_capacity", lambda: True)
    monkeypatch.setattr(main.requests, "get", lambda *args, **kwargs: FakeResponse())

    result = compute_routes(
        RouteRequest(
            source=Coordinates(lat=17.0, lon=78.0),
            destination=Coordinates(lat=17.2, lon=78.2),
            alternatives=1,
        )
    )

    assert result["shortest_route"]["name"] == "Route 1 (backup)"
    assert result["shortest_route"]["distance_meters"] == 19306.5
    assert result["shortest_route"]["coordinates"] == [[17.3616, 78.4747], [17.4435, 78.3772]]
    assert result["dijkstra_steps"] == []


def test_compute_routes_skips_busy_overpass_and_uses_backup(monkeypatch):
    from app import main

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "code": "Ok",
                "routes": [{
                    "distance": 1000,
                    "duration": 120,
                    "geometry": {"coordinates": [[78.0, 17.0], [78.1, 17.1]]},
                }],
            }

    monkeypatch.setattr(main, "overpass_has_capacity", lambda: False)
    monkeypatch.setattr(
        main,
        "get_graph_for_points",
        lambda *args, **kwargs: pytest.fail("Do not query a busy Overpass server"),
    )
    monkeypatch.setattr(main.requests, "get", lambda *args, **kwargs: FakeResponse())

    result = compute_routes(
        RouteRequest(
            source=Coordinates(lat=17.0, lon=78.0),
            destination=Coordinates(lat=17.1, lon=78.1),
        )
    )

    assert result["shortest_route"]["distance_meters"] == 1000


def test_compute_routes_reports_failure_when_backup_router_is_unavailable(monkeypatch):
    from app import main

    connection_error = main.requests.exceptions.ConnectionError

    def fail_request(*args, **kwargs):
        raise connection_error()

    monkeypatch.setattr(
        main,
        "get_graph_for_points",
        fail_request,
    )
    monkeypatch.setattr(main, "overpass_has_capacity", lambda: True)
    monkeypatch.setattr(main.requests, "get", fail_request)
    request = RouteRequest(
        source=Coordinates(lat=17.0, lon=78.0),
        destination=Coordinates(lat=17.2, lon=78.2),
    )

    with pytest.raises(HTTPException) as error:
        compute_routes(request)

    assert error.value.status_code == 503
    assert "Route services" in error.value.detail


def test_road_graph_is_cached_for_repeated_request(monkeypatch):
    from app import main

    main.load_road_graph.cache_clear()
    calls = []

    def fake_graph_from_point(*args, **kwargs):
        calls.append((args, kwargs))
        return nx.MultiDiGraph()

    monkeypatch.setattr(main.ox, "graph_from_point", fake_graph_from_point)
    first = main.Coordinates(lat=17.36, lon=78.47)
    first_destination = main.Coordinates(lat=17.44, lon=78.38)
    nearby = main.Coordinates(lat=17.3602, lon=78.4702)
    nearby_destination = main.Coordinates(lat=17.4402, lon=78.3802)

    main.get_graph_for_points(first, first_destination, "drive")
    main.get_graph_for_points(nearby, nearby_destination, "drive")

    assert len(calls) == 1
    main.load_road_graph.cache_clear()
