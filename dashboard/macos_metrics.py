"""Convert native Apple Silicon/host counters to the existing dashboard API."""

import math
from datetime import datetime

import psutil

# A Mac mini cannot draw anything close to this. Values above it are unit
# errors: macmon's IOReport channels occasionally report milliwatts, which
# turned a 20.6 W sample into a 20654 W spike (and a bogus 18.8 kW alert).
POWER_MAX_W = 500


def watts(value, *, minimum=0.01):
    """Plausible watts from a macmon field, or None.

    > POWER_MAX_W is treated as milliwatts and scaled down; anything still above
    the cap is dropped rather than shown.
    """
    amount = finite(value, minimum=minimum)
    if amount is None:
        return None
    if amount > POWER_MAX_W:
        amount /= 1000
    return amount if amount <= POWER_MAX_W else None


def finite(value, *, minimum=0):
    if isinstance(value, (int, float)) and math.isfinite(value) and value >= minimum:
        return float(value)
    return None


def snapshot(sample):
    mem = psutil.virtual_memory()
    temp = finite(sample.get("temp", {}).get("cpu_temp_avg"), minimum=1)
    # SMC system power covers the Mac itself. Some macOS releases do not expose
    # CPU energy channels through IOReport; do not turn that absence into 0 W.
    system = watts(sample.get("sys_power"))
    cpu = watts(sample.get("cpu_power"), minimum=0.001)
    gpu = watts(sample.get("gpu_power")) if cpu is not None else None
    ane = watts(sample.get("ane_power")) if cpu is not None else None
    soc = watts(sample.get("all_power"))
    total = system if system is not None else soc
    source = "Apple SMC" if system is not None else "Apple IOReport"
    note = (
        "Apple SMC system power sensor; estimated device draw, not wall-plug power."
        if system is not None
        else "CPU + GPU + ANE power from Apple IOReport; not wall-plug power."
    )
    return {
        "t": datetime.now().astimezone().isoformat(timespec="milliseconds"),
        "platform": "macOS",
        "cpu": {
            "util_percent": round(psutil.cpu_percent(), 1),
            "temp_c": round(temp, 1) if temp is not None else None,
            "temp_source": "CPU dies",
        },
        "mem": {
            "total_bytes": mem.total,
            "used_bytes": mem.total - mem.available,
            "free_bytes": mem.free,
            "available_bytes": mem.available,
            "util_percent": round(100 * (mem.total - mem.available) / mem.total, 1),
        },
        "power": {
            "total_w": round(total, 2) if total is not None else None,
            "cpu_w": round(cpu, 2) if cpu is not None else None,
            "gpu_w": round(gpu, 2) if gpu is not None else None,
            "ane_w": round(ane, 2) if ane is not None else None,
            "gpus": [],
            "source": source,
            "note": note,
        },
    }
