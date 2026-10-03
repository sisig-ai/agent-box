"""Convert native Apple Silicon/host counters to the existing dashboard API."""
import math
from datetime import datetime
import psutil


def finite(value, *, minimum=0):
    if isinstance(value, (int, float)) and math.isfinite(value) and value >= minimum:
        return float(value)
    return None


def snapshot(sample):
    mem = psutil.virtual_memory()
    temp = finite(sample.get('temp', {}).get('cpu_temp_avg'), minimum=1)
    # SMC system power covers the Mac itself. Some macOS releases do not expose
    # CPU energy channels through IOReport; do not turn that absence into 0 W.
    system = finite(sample.get('sys_power'), minimum=0.01)
    cpu = finite(sample.get('cpu_power'), minimum=0.001)
    gpu = finite(sample.get('gpu_power')) if cpu is not None else None
    ane = finite(sample.get('ane_power')) if cpu is not None else None
    soc = finite(sample.get('all_power'), minimum=0.01)
    total = system if system is not None else soc
    source = 'Apple SMC' if system is not None else 'Apple IOReport'
    return {
        't': datetime.now().astimezone().isoformat(timespec='milliseconds'),
        'platform': 'macOS',
        'cpu': {'util_percent': round(psutil.cpu_percent(), 1),
                'temp_c': round(temp, 1) if temp is not None else None,
                'temp_source': 'CPU dies'},
        'mem': {'total_bytes': mem.total, 'used_bytes': mem.total-mem.available,
                'free_bytes': mem.free, 'available_bytes': mem.available,
                'util_percent': round(100*(mem.total-mem.available)/mem.total, 1)},
        'power': {'total_w': round(total, 2) if total is not None else None,
                  'cpu_w': round(cpu, 2) if cpu is not None else None,
                  'gpu_w': round(gpu, 2) if gpu is not None else None,
                  'ane_w': round(ane, 2) if ane is not None else None,
                  'gpus': [], 'source': source,
                  'note': 'Apple SMC system power sensor; estimated device draw, not wall-plug power.'
                          if system is not None else 'CPU + GPU + ANE power from Apple IOReport; not wall-plug power.'},
    }
