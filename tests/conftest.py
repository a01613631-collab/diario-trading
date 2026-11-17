import os
import tempfile

# Cada corrida de pruebas usa una base temporal: nunca toca tu diario real.
os.environ["DIARIO_DATOS"] = tempfile.mkdtemp(prefix="diario-pruebas-")
os.environ.pop("ANTHROPIC_API_KEY", None)
