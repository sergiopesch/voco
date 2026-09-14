"""Keep model-library stdout away from the bounded JSON protocol."""
import os
import sys
protocol = os.fdopen(os.dup(1), 'w', buffering=1)
os.dup2(2, 1)
from worker_main import main
sys.exit(main(protocol))
