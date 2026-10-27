from __future__ import annotations

import math
import heapq
from functools import lru_cache
from itertools import count
from typing import Any, Dict, List

import networkx as nx
import osmnx as ox
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="SmartPath API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODE_ALIASES = {
    "driving": "drive",
    "drive": "drive",
    "car": "drive",
    "walking": "walk",
    "walk": "walk",
    "biking": "bike",
    "bike": "bike",
}

AVG_SPEEDS = {
    "drive": 36.0,
    "bike": 18.0,
    "walk": 4.5,
}
ox.settings.requests_timeout = 30


class Coordinates(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class RouteRequest(BaseModel):
    source: Coordinates
    destination: Coordinates
    mode: str = "drive"
    alternatives: int = 3


class GeoResult(BaseModel):
    name: str
    display_name: str
    lat: float
    lon: float


class SearchResponse(BaseModel):
    query: str
    results: List[GeoResult]


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def normalize_mode(mode: str) -> str:
    normalized = MODE_ALIASES.get(mode.lower(), mode.lower())
    if normalized not in AVG_SPEEDS:
        raise HTTPException(status_code=400, detail=f"Unsupported travel mode: {mode}")
    return normalized


def safe_length(graph: nx.Graph, u: Any, v: Any) -> float:
    edge_data = graph.get_edge_data(u, v, default={})
    if not edge_data:
        return 0.0

    if isinstance(edge_data, dict) and 'length' in edge_data:
        return float(edge_data.get('length', 0.0) or 0.0)

    if isinstance(edge_data, dict):
        values = list(edge_data.values())
        if not values:
            return 0.0
        if isinstance(values[0], dict):
            lengths = [float(data.get('length', 0.0) or 0.0) for data in values]
            return min(lengths) if lengths else 0.0
        return float(values[0] or 0.0)

    return float(edge_data or 0.0)


@lru_cache(maxsize=16)
def load_road_graph(center_lat: float, center_lon: float, buffer_meters: int, mode: str) -> nx.MultiDiGraph:
    return ox.graph_from_point(
        (center_lat, center_lon),
        dist=buffer_meters,
        network_type=mode,
        simplify=True,
        retain_all=False,
        truncate_by_edge=True,
    )


def get_graph_for_points(
    source: Coordinates,
    destination: Coordinates,
    mode: str,
    radius_factor: float = 0.65,
) -> nx.MultiDiGraph:
    center_lat = round((source.lat + destination.lat) / 2.0, 3)
    center_lon = round((source.lon + destination.lon) / 2.0, 3)
    distance = haversine_meters(source.lat, source.lon, destination.lat, destination.lon)
    buffer_meters = max(distance * radius_factor, 2000.0)
    if buffer_meters > 50000:
        buffer_meters = 50000
    rounded_buffer = min(50000, int(math.ceil((buffer_meters + 250) / 1000) * 1000))
    return load_road_graph(center_lat, center_lon, rounded_buffer, mode)


def dijkstra_shortest_path(
    graph: nx.MultiDiGraph,
    source: Any,
    target: Any,
) -> tuple[List[Any], List[Dict[str, Any]]]:
    dist = {source: 0.0}
    sequence = count()
    queue = [(0.0, next(sequence), source)]
    visited: set[Any] = set()
    steps: List[Dict[str, Any]] = []
    previous: Dict[Any, Any] = {}

    while queue:
        current_distance, _, node = heapq.heappop(queue)
        if node in visited or current_distance > dist.get(node, math.inf):
            continue
        visited.add(node)
        steps.append(
            {
                "node_id": int(node) if isinstance(node, int) else str(node),
                "distance_m": round(current_distance, 1),
                "visited_count": len(visited),
            }
        )
        if node == target:
            break
        for neighbor, edge_data in graph.adj.get(node, {}).items():
            edge_weight = min(
                (float(values.get("length", 0.0) or 0.0) for values in edge_data.values()),
                default=0.0,
            )
            candidate = current_distance + edge_weight
            if neighbor not in dist or candidate < dist[neighbor]:
                dist[neighbor] = candidate
                previous[neighbor] = node
                heapq.heappush(queue, (candidate, next(sequence), neighbor))

    if target not in visited:
        raise nx.NetworkXNoPath(f"No path between {source} and {target}")
    return reconstruct_path(previous, source, target), steps


def dijkstra_steps(graph: nx.MultiDiGraph, source: Any, target: Any) -> List[Dict[str, Any]]:
    try:
        _, steps = dijkstra_shortest_path(graph, source, target)
        return steps
    except nx.NetworkXNoPath:
        return []


def reconstruct_path(previous: Dict[Any, Any], source: Any, target: Any) -> List[Any]:
    if target not in previous and source != target:
        raise nx.NetworkXNoPath(f"No path between {source} and {target}")
    route: List[Any] = []
    current = target
    while current is not None:
        route.append(current)
        if current == source:
            break
        current = previous.get(current)
    return list(reversed(route))


def path_cost(graph: nx.Graph, path: List[Any]) -> float:
    total = 0.0
    for u, v in zip(path, path[1:]):
        total += safe_length(graph, u, v)
    return total


def simple_routing_graph(graph: nx.MultiDiGraph) -> nx.DiGraph:
    routing_graph = nx.DiGraph()
    routing_graph.add_nodes_from(graph.nodes(data=True))

    for source, target, edge_data in graph.edges(data=True):
        length = float(edge_data.get("length", 0.0) or 0.0)
        if not routing_graph.has_edge(source, target) or length < routing_graph[source][target]["length"]:
            routing_graph.add_edge(source, target, length=length)

    return routing_graph


def yen_k_shortest_paths(graph: nx.MultiDiGraph, source: Any, target: Any, k: int) -> List[List[Any]]:
    if k <= 0:
        return []
    if source == target:
        return [[source]]

    routing_graph = simple_routing_graph(graph)
    paths = nx.shortest_simple_paths(routing_graph, source, target, weight="length")
    return [path for _, path in zip(range(k), paths)]


def build_route_payload(graph: nx.MultiDiGraph, path: List[Any], mode: str, route_name: str) -> Dict[str, Any]:
    coordinates = [(graph.nodes[node]["y"], graph.nodes[node]["x"]) for node in path]
    total_distance = path_cost(graph, path)
    speed = AVG_SPEEDS.get(mode, AVG_SPEEDS["drive"])
    duration_minutes = (total_distance / 1000.0) / speed * 60.0
    segments: List[Dict[str, Any]] = []
    for u, v in zip(path, path[1:]):
        segment_distance = safe_length(graph, u, v)
        segments.append(
            {
                "from": str(u),
                "to": str(v),
                "distance_meters": round(segment_distance, 1),
                "estimated_minutes": round((segment_distance / 1000.0) / speed * 60.0, 2),
            }
        )
    return {
        "id": route_name,
        "name": route_name,
        "coordinates": coordinates,
        "distance_meters": round(total_distance, 1),
        "duration_minutes": round(duration_minutes, 2),
        "segments": segments,
        "description": f"{route_name.title()} route via the nearest road network nodes.",
    }


def get_osrm_fallback(request: RouteRequest, mode: str) -> Dict[str, Any]:
    if mode != "drive":
        raise HTTPException(
            status_code=503,
            detail="OpenStreetMap route data is temporarily unavailable. The backup router currently supports driving routes only.",
        )

    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{request.source.lon},{request.source.lat};{request.destination.lon},{request.destination.lat}"
    )
    try:
        response = requests.get(
            url,
            params={"overview": "full", "geometries": "geojson", "steps": "false"},
            timeout=15,
            headers={"User-Agent": "SmartPath/1.0 (routing demo)"},
        )
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as exc:
        raise HTTPException(
            status_code=503,
            detail="Route services are temporarily unavailable. Please try again shortly.",
        ) from exc

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=503,
            detail="The backup routing service returned an invalid response. Please try again shortly.",
        )
    routes = data.get("routes", [])
    route = routes[0] if routes else None
    geometry = route.get("geometry", {}) if isinstance(route, dict) else {}
    coordinates = geometry.get("coordinates", []) if isinstance(geometry, dict) else []
    if data.get("code") != "Ok" or not isinstance(route, dict) or not coordinates:
        raise HTTPException(
            status_code=503,
            detail="No driving route is available for these locations right now. Please try again shortly.",
        )

    try:
        distance_meters = float(route["distance"])
        duration_minutes = float(route["duration"]) / 60
        route_coordinates = [[float(latitude), float(longitude)] for longitude, latitude in coordinates]
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=503,
            detail="The backup routing service returned an invalid route. Please try again shortly.",
        ) from exc

    route_payload = {
        "id": "route-1",
        "name": "Route 1 (backup)",
        "rank": 1,
        "color": "#C9A24A",
        "coordinates": route_coordinates,
        "distance_meters": round(distance_meters, 1),
        "duration_minutes": round(duration_minutes, 2),
        "segments": [],
        "description": "Driving route provided by the backup routing service.",
    }
    return {
        "source": {"lat": request.source.lat, "lon": request.source.lon},
        "destination": {"lat": request.destination.lat, "lon": request.destination.lon},
        "mode": mode,
        "routes": [route_payload],
        "shortest_route": route_payload,
        "dijkstra_steps": [],
    }


def overpass_has_capacity() -> bool:
    status_url = ox.settings.overpass_url.rstrip("/") + "/status"
    try:
        response = requests.get(
            status_url,
            timeout=4,
            headers={"User-Agent": "SmartPath/1.0 (routing demo)"},
        )
        response.raise_for_status()
    except requests.exceptions.RequestException:
        return False

    status_lines = response.text.splitlines()
    status_tokens = status_lines[4].split() if len(status_lines) > 4 else []
    return bool(status_tokens and status_tokens[0].isdigit())


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/search", response_model=SearchResponse)
def geocode_location(query: str = Query(..., min_length=2)) -> SearchResponse:
    url = "https://nominatim.openstreetmap.org/search"
    response = requests.get(
        url,
        params={
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "limit": 5,
        },
        timeout=15,
        headers={"User-Agent": "SmartPath/1.0 (routing demo)"},
    )
    response.raise_for_status()
    data = response.json()
    results = [
        GeoResult(
            name=item.get("name") or item.get("display_name", "Unknown location"),
            display_name=item.get("display_name", "Unknown location"),
            lat=float(item["lat"]),
            lon=float(item["lon"]),
        )
        for item in data
    ]
    return SearchResponse(query=query, results=results)


@app.post("/api/routes")
def compute_routes(request: RouteRequest) -> Dict[str, Any]:
    mode = normalize_mode(request.mode)
    if not overpass_has_capacity():
        return get_osrm_fallback(request, mode)

    try:
        graph = get_graph_for_points(request.source, request.destination, mode)
    except (ox._errors.ResponseStatusCodeError, requests.exceptions.RequestException):
        return get_osrm_fallback(request, mode)

    if graph.number_of_nodes() == 0:
        raise HTTPException(status_code=404, detail="No road network was found for the selected coordinates.")

    source_node = ox.nearest_nodes(graph, request.source.lon, request.source.lat)
    destination_node = ox.nearest_nodes(graph, request.destination.lon, request.destination.lat)
    alternatives_count = max(1, min(request.alternatives, 5))

    if source_node == destination_node:
        shortest_path = [source_node]
        steps = [{
            "node_id": int(source_node) if isinstance(source_node, int) else str(source_node),
            "distance_m": 0.0,
            "visited_count": 1,
        }]
    else:
        try:
            shortest_path, steps = dijkstra_shortest_path(graph, source_node, destination_node)
        except nx.NetworkXNoPath:
            try:
                graph = get_graph_for_points(request.source, request.destination, mode, radius_factor=1.35)
            except (ox._errors.ResponseStatusCodeError, requests.exceptions.RequestException):
                return get_osrm_fallback(request, mode)
            if graph.number_of_nodes() == 0:
                raise HTTPException(status_code=404, detail="No road network was found for the selected coordinates.")
            source_node = ox.nearest_nodes(graph, request.source.lon, request.source.lat)
            destination_node = ox.nearest_nodes(graph, request.destination.lon, request.destination.lat)
            try:
                shortest_path, steps = dijkstra_shortest_path(graph, source_node, destination_node)
            except nx.NetworkXNoPath as exc:
                raise HTTPException(status_code=404, detail="No valid route could be found between the selected points.") from exc

    candidate_paths = [shortest_path]
    if alternatives_count > 1 and source_node != destination_node:
        alternatives = yen_k_shortest_paths(graph, source_node, destination_node, alternatives_count + 1)
        candidate_paths.extend(path for path in alternatives if path != shortest_path)
        candidate_paths = candidate_paths[:alternatives_count]

    route_payloads = [
        build_route_payload(graph, path, mode, f"route-{index + 1}")
        for index, path in enumerate(candidate_paths)
    ]
    route_payloads.sort(key=lambda item: item["distance_meters"])
    for index, route in enumerate(route_payloads):
        route["rank"] = index + 1
        route["color"] = ["#C9A24A", "#E4C675", "#A8843B", "#F0DDA8", "#8F6A2B"][index % 5]

    shortest_route = route_payloads[0]
    return {
        "source": {"lat": request.source.lat, "lon": request.source.lon},
        "destination": {"lat": request.destination.lat, "lon": request.destination.lon},
        "mode": mode,
        "routes": route_payloads,
        "shortest_route": shortest_route,
        "dijkstra_steps": steps,
    }


@app.get("/")
def index() -> Dict[str, str]:
    return {"message": "SmartPath backend is running."}
