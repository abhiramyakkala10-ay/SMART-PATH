# SmartPath — Intelligent Multi-Route Navigation System

SmartPath is a production-style route-planning web application built with a FastAPI backend and a React + Vite frontend. It allows users to search for origins and destinations, calculate alternative routes, compare route lengths, and visualize Dijkstra-style traversal in an interactive Leaflet map.

## Core features

- Interactive map with OpenStreetMap tiles
- Source and destination search with autocomplete-style suggestions
- Map-based point selection
- Dijkstra-inspired shortest path exploration
- Multiple route alternatives using a k-shortest path strategy
- mode switching for drive, bike, and walk
- Responsive dashboard UI with route comparison cards
- API endpoints for geocoding and route computation

## Stack

Frontend:
- React
- Vite
- TypeScript
- Tailwind CSS
- React Leaflet
- Recharts
- TanStack Query

Backend:
- FastAPI
- Uvicorn
- NetworkX
- OSMnx
- NumPy
- Pydantic

## Quick start

1. Create and activate a Python virtual environment.
2. Install backend dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
3. Start the API:
   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
4. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```
5. Run the UI:
   ```bash
   npm run dev
   ```
6. Open the Vite app at http://localhost:5173

## API endpoints

- GET /health
- GET /api/search?query=delhi
- POST /api/routes

## Testing

```bash
cd backend
PYTHONPATH=. pytest -q
```
