"""Extractor de planillas (Excel y PDF) -> JSON con el desglose de cada persona.

API (lo unico que necesitas para integrarlo):

    from planillas import extraer, a_filas, a_csv

    datos = extraer("PLANILLA 1RA QUINCENA SEPTIEMBRE 2026.xlsx")
    datos = extraer(archivo_subido, nombre="planilla.xlsx")   # bytes o file-like (web)

CLI:
    python planillas.py archivo.xlsx [-o salida.csv] [--json salida.json]
    python planillas.py --test

Dependencias: openpyxl (Excel). pdfplumber solo si vas a leer PDFs.
"""
import io, os, re, json, sys
from decimal import Decimal, ROUND_HALF_UP

TOTAL_RE   = re.compile(r"TOTAL A CANCELAR", re.I)
EMPRESA_RE = re.compile(r"S\.?A\.? DE C\.?V\.?", re.I)
PROY_RE    = re.compile(r"PROYECTO|CONTRATO|PLANILLA GENERAL", re.I)
PER_RE     = re.compile(r"QUINCENA|MES DE|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|"
                        r"SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE", re.I)


# ---------------------------------------------------------------- utilidades

def _txt(v):
    return " ".join(str(v).split()) if v is not None else ""


def _redondea(x):
    """Centavos como los redondea Excel (0.5 hacia arriba), no como el round() de Python."""
    return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _num(v):
    """Numero de Excel tal cual; de PDF ('-$ 1,000.00-') se rescatan los digitos."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return _redondea(v)
    for line in str(v or "").split("\n"):
        if any(ch.isdigit() for ch in line):
            try:
                return _redondea(re.sub(r"[^\d.]", "", line.replace(",", "")))
            except ValueError:
                return 0.0
    return 0.0


def _es_encabezado(linea):
    """Texto que pertenece al encabezado, no a un valor ('-$ - -' no lo es)."""
    return bool(linea) and not any(ch.isdigit() or ch in "$-" for ch in linea)


def _meta(lineas):
    """Proyecto y periodo de las lineas que estan sobre la tabla."""
    util = [l for l in lineas if l and not EMPRESA_RE.search(l)]
    proyecto = next((l for l in util if PROY_RE.search(l)), "")
    periodo = next((l for l in util if PER_RE.search(l) and l != proyecto), "")
    return proyecto.split(",")[0].strip(), periodo   # "PLANILLA GENERAL, CORRESPONDIENTES DE"


def _columnas(cabecera):
    """Nombres de columna sin repetidos ('RENTA' dos veces -> 'RENTA' y 'RENTA_2')."""
    seen, out = {}, []
    for c in cabecera:
        c = _txt(c) or "COL"
        seen[c] = seen.get(c, 0) + 1
        out.append(c if seen[c] == 1 else f"{c}_{seen[c]}")
    return out


def _fila_encabezado(grid):
    for i, row in enumerate(grid):
        if any(_txt(c).upper() == "EMPLEADO" for c in row):
            return i
    return None


# ---------------------------------------------------------------- lectura

def _secciones_excel(fuente):
    """[(nombre_hoja, lineas_de_arriba, grid_desde_el_encabezado)] por cada hoja con tabla."""
    import openpyxl
    wb = openpyxl.load_workbook(fuente, data_only=True, read_only=True)
    for ws in wb.worksheets:
        grid = [list(r) for r in ws.iter_rows(values_only=True)]
        h = _fila_encabezado(grid)
        if h is None:
            continue
        arriba = [_txt(c) for row in grid[:h] for c in row if _txt(c)]
        yield ws.title, arriba, grid[h:]
    wb.close()


def _secciones_pdf(fuente):
    """Igual que _secciones_excel, pero des-solapando el texto que el PDF encima
    (la 2a linea del encabezado cae dentro de las celdas de la 1a persona)."""
    import pdfplumber
    with pdfplumber.open(fuente) as pdf:
        for n, page in enumerate(pdf.pages, 1):
            lineas = [l.strip() for l in (page.extract_text() or "").split("\n") if l.strip()]
            i = next((k for k, l in enumerate(lineas) if "EMPLEADO" in l.upper()), None)
            sobras = set()
            for l in (lineas[i:i + 3] if i is not None else []):
                if re.match(r"\d", l):
                    break
                sobras |= {w for w in l.split() if _es_encabezado(w)}
            for tabla in page.extract_tables():
                h = _fila_encabezado(tabla)
                if h is None:
                    continue
                cols = [_txt(c) for c in tabla[h]]
                dl = max((k for k, c in enumerate(cols) if c.upper().startswith("D.L")), default=3)
                for row in tabla[h + 1:h + 3]:                 # completar nombres partidos
                    for k in range(dl + 1, min(len(cols), len(row))):
                        for line in map(_txt, (row[k] or "").split("\n")):
                            if _es_encabezado(line):
                                cols[k] = f"{cols[k]} {line}".strip()
                limpias = [cols]
                for row in tabla[h + 1:]:
                    fila = list(row) + [None] * (len(cols) - len(row))
                    for k in range(min(dl + 1, len(fila))):     # texto: quitar sobras del encabezado
                        if len(cols[k].split()) == 1:           # encabezado partido ('PUESTO')
                            fila[k] = " ".join(l for l in map(_txt, (fila[k] or "").split("\n"))
                                               if l and not set(l.split()) <= sobras)
                        else:
                            fila[k] = _txt(str(fila[k] or "").replace("\n", " "))
                    limpias.append(fila)
                yield f"pagina {n}", lineas[:i or 5], limpias


# ---------------------------------------------------------------- parseo

def _parse(seccion, arriba, grid, archivo):
    cols = _columnas(grid[0])
    dl = max((i for i, c in enumerate(cols) if c.upper().startswith("D.L")), default=3)
    proyecto, periodo = _meta(arriba)
    personas, declarado = [], None
    for row in grid[1:]:
        row = list(row) + [None] * (len(cols) - len(row))
        if any(TOTAL_RE.search(_txt(c)) for c in row[:dl + 1]):
            declarado = _montos(cols, row, dl)
            continue
        item = re.search(r"\d+", _txt(row[0]))
        nombre = _txt(row[1])
        if not (item and nombre):
            continue
        montos = _montos(cols, row, dl)
        personas.append({
            "archivo": archivo, "seccion": seccion, "proyecto": proyecto, "periodo": periodo,
            "item": int(item.group()), "empleado": nombre, "puesto": _txt(row[2]),
            "dias_laborados": _txt(row[3]) if dl >= 3 else "",
            "montos": montos, "total_pagado": _total(montos),
        })
    return personas, declarado


def _montos(cols, row, dl):
    return {cols[i]: _num(row[i]) for i in range(dl + 1, len(cols)) if cols[i] != "COL"}


def _total(montos):
    """Lo que recibe la persona: la ultima columna 'TOTAL A PAGAR' con valor."""
    pagos = [v for k, v in montos.items() if "TOTAL A PAGAR" in k.upper()]
    return next((v for v in reversed(pagos) if v), pagos[-1] if pagos else 0.0)


# ---------------------------------------------------------------- API

def extraer(fuente, nombre=None):
    """Lee un .xlsx o .pdf y devuelve un dict listo para JSON:

    {"archivo": "...",
     "personas":  [ {archivo, seccion, proyecto, periodo, item, empleado, puesto,
                     dias_laborados, montos: {COLUMNA: monto, ...}, total_pagado} ],
     "planillas": [ {seccion, proyecto, periodo, personas, total, total_declarado, cuadra} ]}

    `fuente` puede ser una ruta, bytes o un file-like (p.ej. el archivo de un upload).
    """
    datos, archivo = _abrir(fuente, nombre)
    secciones = _secciones_pdf(datos) if _es_pdf(datos) else _secciones_excel(datos)
    personas, planillas = [], []
    for seccion, arriba, grid in secciones:
        gente, declarado = _parse(seccion, arriba, grid, archivo)
        if not gente:
            continue
        total = _redondea(sum(p["total_pagado"] for p in gente))
        dec = _total(declarado) if declarado else None
        personas += gente
        planillas.append({
            "seccion": seccion, "proyecto": gente[0]["proyecto"], "periodo": gente[0]["periodo"],
            "personas": len(gente), "total": total, "total_declarado": dec,
            "cuadra": dec is None or abs(total - dec) < 0.05,
        })
    return {"archivo": archivo, "personas": personas, "planillas": planillas}


def a_filas(datos):
    """Aplana `montos` para una tabla/CSV: [(columnas, [fila, ...])]."""
    cols, filas = [], []
    for p in datos["personas"]:
        for k in p["montos"]:
            if k not in cols:
                cols.append(k)
    base = ["proyecto", "periodo", "seccion", "item", "empleado", "puesto", "dias_laborados"]
    for p in datos["personas"]:
        filas.append([p[k] for k in base] + [p["montos"].get(c, "") for c in cols] + [p["total_pagado"]])
    return base + cols + ["TOTAL PAGADO"], filas


def a_csv(datos, ruta):
    import csv
    cols, filas = a_filas(datos)
    with open(ruta, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(filas)
    return ruta


# ---------------------------------------------------------------- internos

def _es_pdf(datos):
    if isinstance(datos, str):
        return datos.lower().endswith(".pdf")
    pos = datos.tell()
    cabeza = datos.read(4)
    datos.seek(pos)
    return cabeza == b"%PDF"


def _abrir(fuente, nombre):
    if isinstance(fuente, (str, os.PathLike)):
        return str(fuente), os.path.basename(str(fuente))
    if isinstance(fuente, (bytes, bytearray)):
        fuente = io.BytesIO(fuente)
    return fuente, nombre or "archivo"


# ---------------------------------------------------------------- CLI / test

def _test():
    assert _num(1000) == 1000.0 and _num("-$ 1,000.00-") == 1000.0
    assert _num("-$ - -") == 0.0 and _num(None) == 0.0
    assert _num("-$ 1L50.00-") == 150.0                    # letra pegada por el PDF
    assert _num("PAGAR SERV.\n-$ 675.00-\nPROF. +") == 675.0
    assert _num(32.625) == 32.63 and _num(388.825) == 388.83     # centavos como Excel
    assert _columnas(["RENTA", "RENTA", None]) == ["RENTA", "RENTA_2", "COL"]
    assert _meta(["PLANILLA GENERAL, CORRESPONDIENTES DE", "1RA QUINCENA"])[0] == "PLANILLA GENERAL"
    assert _meta(["INGENIERIA Y PROYECTOS MORALES, S.A. DE C.V.", "PROYECTO EL CHANGALLO",
                  "1RA QUINCENA SEPTIEMBRE 2026"]) == ("PROYECTO EL CHANGALLO",
                                                       "1RA QUINCENA SEPTIEMBRE 2026")
    assert _total({"TOTAL A PAGAR": 675.0, "TOTAL A PAGAR_2": 0.0}) == 675.0
    assert _total({"TOTAL A PAGAR": 0.0, "TOTAL A PAGAR_2": 0.0}) == 0.0
    grid = [["ITEM", "EMPLEADO", "PUESTO", "D.L.", "SERVICIOS", "TOTAL A PAGAR"],
            [1, "ANA", "ING.", 15, 500, 450],
            ["TOTAL A CANCELAR", None, None, None, 500, 450]]
    gente, dec = _parse("h", ["PROYECTO X", "1RA QUINCENA"], grid, "a.xlsx")
    assert gente[0]["empleado"] == "ANA" and gente[0]["montos"]["SERVICIOS"] == 500.0
    assert gente[0]["total_pagado"] == 450.0 and _total(dec) == 450.0
    print("ok")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = sys.argv[1:]
    if "--test" in args:
        _test(); sys.exit()
    salidas = {}
    for flag in ("-o", "--json"):
        if flag in args:
            i = args.index(flag); salidas[flag] = args[i + 1]; del args[i:i + 2]
    if not args:
        print(__doc__); sys.exit(1)
    datos = extraer(args[0])
    cols, filas = a_filas(datos)
    ancho = [max(len(str(x)) for x in [c] + [f[i] for f in filas]) for i, c in enumerate(cols)]
    for fila in [cols] + filas:
        print("  ".join(str(v).ljust(w) for v, w in zip(fila, ancho)))
    print("\nPor planilla:")
    for p in datos["planillas"]:
        print(f"  {p['proyecto']:<45} {p['personas']:>3} personas  ${p['total']:>10,.2f}"
              + ("" if p["cuadra"] else f"  ! no cuadra con el total de la hoja ({p['total_declarado']})"))
    if "-o" in salidas:
        print("->", a_csv(datos, salidas["-o"]))
    if "--json" in salidas:
        with open(salidas["--json"], "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, indent=2)
        print("->", salidas["--json"])
