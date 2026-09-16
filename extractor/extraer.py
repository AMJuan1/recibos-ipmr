"""Lee la planilla por stdin (bytes) y escribe el JSON del extractor en stdout.
Uso: python extractor/extraer.py <nombre-del-archivo>  < planilla.xlsx
"""
import json, sys
from planillas import extraer

sys.stdout.reconfigure(encoding="utf-8")
nombre = sys.argv[1] if len(sys.argv) > 1 else "planilla.xlsx"
json.dump(extraer(sys.stdin.buffer.read(), nombre=nombre), sys.stdout, ensure_ascii=False)
