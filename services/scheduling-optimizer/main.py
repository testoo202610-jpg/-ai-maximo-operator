"""Local-only CP-SAT scheduling service. Node independently validates every result."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ortools.sat.python import cp_model

app = FastAPI(title="Maximo scheduling optimizer")
RIYADH = ZoneInfo("Asia/Riyadh")

class Request(BaseModel):
    parameters: dict
    context: dict

def stamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

def solve(parameters, context):
    model = cp_model.CpModel()
    p, c = parameters, context
    origin = datetime.fromisoformat(p["startDate"] + "T00:00:00").replace(tzinfo=RIYADH)
    min_start = int((stamp(p["startDate"] + "T" + p.get("startTime", "08:00") + ":00+03:00") - origin).total_seconds() / 60)
    records = [r for r in c["records"] if r["type"] == "WO" and r["status"] not in ["COMP", "CLOSE", "CAN"]
               and (not p.get("pmLinkedOnly") or r.get("pmId"))
               and (not p.get("project") or r["project"] == p["project"])
               and (not p.get("building") or r["building"] == p["building"])
               and (p.get("includeScheduled") or not r.get("scheduledStart"))
               and (not p.get("recordIds") or any(i["id"] == r["id"] and i["siteId"] == r["siteId"] and i["type"] == r["type"] for i in p["recordIds"]))]
    if len(records) > 500:
        raise ValueError("Optimizer task limit is 500")
    horizon = p.get("days", 7) * 1440
    colors = sorted({r["color"] for r in records if r.get("color")})
    color_days = {}
    if p.get("colorSeparation"):
        for color in colors:
            color_days[color] = model.new_int_var(0, p.get("days", 7) - 1, "color_" + color)
        if len(colors) <= p.get("days", 7):
            model.add_all_different(list(color_days.values()))
        else:
            # Keep separate day constraints; excess groups remain explicitly unscheduled.
            color_days = {color: idx for idx, color in enumerate(colors)}
    choices, labor_intervals, objectives, reasons = {}, {}, [], {}
    selected_ids = {(r["siteId"], r["id"]) for r in records}
    # Existing reservations are retained unless the same record is selected for rescheduling.
    for labor in c["labor"]:
        labor_intervals[labor["id"]] = []
        for r in c["records"]:
            if r["type"] != "WO" or not r.get("scheduledStart") or not r.get("scheduledFinish") or r.get("laborId") != labor["id"] or (r["siteId"], r["id"]) in selected_ids:
                continue
            start = max(0, int((stamp(r["scheduledStart"]) - origin).total_seconds() / 60))
            end = min(horizon, int((stamp(r["scheduledFinish"]) - origin).total_seconds() / 60))
            if end > start:
                labor_intervals[labor["id"]].append(model.new_fixed_size_interval_var(start, end - start, "existing_" + r["id"]))
    loads = {l["id"]: [] for l in c["labor"]}
    for idx, r in enumerate(records):
        key = r["siteId"] + ":" + r["id"]
        rule = c["rules"].get(r["building"], {})
        minutes = r.get("duration") if rule.get("jobPlanPrecedence") and r.get("duration") else p.get("durationOverride") or rule.get("minutes") or r.get("duration")
        choices[key] = []
        if not r.get("materialsReady") or r["building"] in c.get("restrictedBuildings", []) or not minutes or (p.get("colorSeparation") and not r.get("color")):
            reasons[key] = "Materials, duration, restriction or unconfirmed color prevents scheduling"
            continue
        for day in range(p.get("days", 7)):
            day_string = (origin + timedelta(days=day)).date().isoformat()
            if day_string in c.get("holidays", []):
                continue
            for shift in c["shifts"]:
                lower = max(min_start, day * 1440 + shift["startHour"] * 60)
                upper = min(horizon, day * 1440 + shift["startHour"] * 60 + shift["hours"] * 60) - minutes
                if r.get("earliestStart"):
                    lower = max(lower, int((stamp(r["earliestStart"]) - origin).total_seconds() / 60))
                if r.get("latestFinish"):
                    upper = min(upper, int((stamp(r["latestFinish"]) - origin).total_seconds() / 60) - minutes)
                if upper < lower:
                    continue
                for labor in c["labor"]:
                    if r["siteId"] not in labor["siteIds"] or r["skill"] not in labor["skills"] or shift["id"] not in labor["shifts"] or day_string in labor.get("unavailableDates", []):
                        continue
                    windows = [w for w in c.get("availability", []) if w["laborId"] == labor["id"]]
                    ranges = [(lower, upper)] if not windows else [(max(lower, int((stamp(w["start"]) - origin).total_seconds() / 60)), min(upper, int((stamp(w["finish"]) - origin).total_seconds() / 60) - minutes)) for w in windows]
                    for lo, hi in ranges:
                        if hi < lo:
                            continue
                        label = f"task_{idx}_{day}_{shift['id']}_{labor['id']}_{lo}"
                        chosen = model.new_bool_var(label)
                        start = model.new_int_var(lo, hi, label + "_start")
                        end = model.new_int_var(lo + minutes, hi + minutes, label + "_end")
                        interval = model.new_optional_interval_var(start, minutes, end, chosen, label + "_interval")
                        labor_intervals[labor["id"]].append(interval)
                        if p.get("colorSeparation"):
                            model.add(color_days[r["color"]] == day).only_enforce_if(chosen)
                        choices[key].append((chosen, start, end, labor["id"], shift["id"], minutes))
                        due_day = (stamp(r.get("targetFinish") or r["due"]).astimezone(RIYADH).date() - origin.date()).days
                        weight = 100000 + (6 - r["priority"]) * 10000 + max(0, -due_day) * 1000 - max(0, day - due_day) * 500 - day * 10
                        objectives.append(chosen * weight)
                        loads[labor["id"]].append(chosen * minutes)
        if choices[key]:
            model.add_at_most_one(x[0] for x in choices[key])
    for intervals in labor_intervals.values():
        model.add_no_overlap(intervals)
    maximum_load = model.new_int_var(0, max(1, len(records) * 480), "maximum_workload")
    for terms in loads.values():
        model.add(maximum_load >= sum(terms))
    model.maximize(sum(objectives) - maximum_load)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 8
    solver.parameters.num_search_workers = 2
    status = solver.solve(model)
    items, unscheduled = [], []
    for r in records:
        key = r["siteId"] + ":" + r["id"]
        found = False
        if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            for chosen, start, end, labor_id, shift_id, minutes in choices[key]:
                if solver.value(chosen):
                    iso = lambda value: (origin + timedelta(minutes=solver.value(value))).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                    items.append({"identity": {"type": "WO", "id": r["id"], "siteId": r["siteId"]}, "description": r["description"], "start": iso(start), "finish": iso(end), "laborId": labor_id, "minutes": minutes, "color": r.get("color"), "building": r["building"], "due": r["due"], "priority": r["priority"], "shift": shift_id})
                    found = True
                    break
        if not found:
            unscheduled.append({"identity": {"type": "WO", "id": r["id"], "siteId": r["siteId"]}, "reason": reasons.get(key, "No feasible assignment within confirmed labor, shifts, color days and horizon")})
    return {"items": items, "unscheduled": unscheduled, "status": solver.status_name(status), "objective": solver.objective_value if status in [cp_model.OPTIMAL, cp_model.FEASIBLE] else None}

@app.get("/health")
def health():
    return {"solver": "OR-Tools CP-SAT", "ready": True}

@app.post("/solve")
def optimize(request: Request):
    try:
        return solve(request.parameters, request.context)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
