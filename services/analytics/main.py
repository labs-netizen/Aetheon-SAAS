"""
Aetheon Analytics Microservice - FastAPI Application
Exposes strongly-typed numerical endpoints for forecasting, deviation modeling, and BESS optimization.
"""

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
import os

from schemas import (
    GridForecastRequest, GridForecastResponse,
    DSMCalculationRequest, DSMCalculationResponse,
    BESSSolverRequest, BESSSolverResponse,
    RenewableReconciliationRequest, RenewableReconciliationResponse
)
from solvers import (
    solve_grid_forecast, solve_dsm_deviation,
    solve_bess_advisory, solve_renewable_reconciliation
)

app = FastAPI(
    title="Aetheon Analytics Engine",
    version="1.0.0",
    description="Numerical optimization, 96-block forecasting, and DSM deviation calculation service."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

SERVICE_TOKEN = os.getenv("ANALYTICS_SERVICE_TOKEN", "internal-dev-secret-token")


def verify_service_token(authorization: str = Header(default="")):
    """Internal service authentication. Rejects missing or mismatched tokens."""
    token = authorization.replace("Bearer ", "").strip()
    if not token or token != SERVICE_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing service authorization token"
        )
    return True


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "aetheon-analytics",
        "version": "1.0.0",
        "engine": "python-fastapi-numerical"
    }


@app.post("/v1/grid/forecast", response_model=GridForecastResponse)
def get_grid_forecast(req: GridForecastRequest, _=Depends(verify_service_token)):
    return solve_grid_forecast(req)


@app.post("/v1/dsm/deviation", response_model=DSMCalculationResponse)
def calculate_dsm_deviation(req: DSMCalculationRequest, _=Depends(verify_service_token)):
    return solve_dsm_deviation(req)


@app.post("/v1/bess/optimise-demo", response_model=BESSSolverResponse)
def optimise_bess(req: BESSSolverRequest, _=Depends(verify_service_token)):
    return solve_bess_advisory(req)


@app.post("/v1/renewables/reconcile", response_model=RenewableReconciliationResponse)
def reconcile_renewables(req: RenewableReconciliationRequest, _=Depends(verify_service_token)):
    return solve_renewable_reconciliation(req)
