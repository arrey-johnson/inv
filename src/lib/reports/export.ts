import * as XLSX from "xlsx";
import { formatDate } from "@/lib/utils/dates";
import type { Report, ReportCell, ReportColumn } from "./types";

/**
 * CSV and Excel serializers. Money is written as plain numbers (no thousands separators) so a spreadsheet
 * can sum them; dates are ISO text in CSV and real dates in Excel.
 */

/** Neutralise spreadsheet formulas: a text cell must never start with = + - @ (CSV injection). */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: ReportCell, column?: ReportColumn): string {
  if (value === null || value === undefined || value === "") return "";
  const text = typeof value === "number" ? String(value) : column?.type === "date" ? String(value) : safeText(String(value));
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 CSV with a BOM (Excel opens accented text correctly) and CRLF line endings. */
export function reportToCsv(report: Report): string {
  const lines: string[] = [];
  lines.push([report.title].map((v) => csvCell(v)).join(","));
  lines.push(
    csvCell(report.period ? `Period: ${report.period.from} to ${report.period.to}` : "As of today") + "," + csvCell(`Currency: ${report.currency}`),
  );
  lines.push("");
  lines.push(report.columns.map((c) => csvCell(c.label)).join(","));
  for (const row of report.rows) lines.push(report.columns.map((c) => csvCell(row[c.key] ?? null, c)).join(","));
  if (report.totals) {
    lines.push(report.columns.map((c) => csvCell(report.totals![c.key] ?? null, c)).join(","));
  }
  if (report.notes.length > 0) {
    lines.push("");
    for (const note of report.notes) lines.push(csvCell(note));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function excelCell(value: ReportCell, column: ReportColumn): XLSX.CellObject | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const format = column.type === "money" ? "#,##0.00" : column.type === "percent" ? '0.00"%"' : "0";
    return { t: "n", v: value, z: format };
  }
  if (column.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    return { t: "d", v: new Date(Date.UTC(y, m - 1, d)), z: "yyyy-mm-dd" };
  }
  return { t: "s", v: safeText(value) };
}

/** An .xlsx workbook with one sheet: title, period, table, totals and notes. */
export function reportToXlsx(report: Report): Uint8Array {
  const aoa: Array<Array<string | number | null>> = [
    [report.title],
    [report.period ? `Period: ${report.period.from} to ${report.period.to}` : "As of today", `Currency: ${report.currency}`],
    [],
    report.columns.map((c) => c.label),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  let rowIndex = aoa.length;
  const put = (values: Record<string, ReportCell>) => {
    report.columns.forEach((column, c) => {
      const cell = excelCell(values[column.key] ?? null, column);
      if (cell) sheet[XLSX.utils.encode_cell({ r: rowIndex, c })] = cell;
    });
    rowIndex += 1;
  };
  for (const row of report.rows) put(row);
  if (report.totals) put(report.totals);
  rowIndex += 1;
  for (const note of report.notes) {
    sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 0 })] = { t: "s", v: note };
    rowIndex += 1;
  }
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rowIndex - 1, 0), c: Math.max(report.columns.length - 1, 0) } });
  sheet["!cols"] = report.columns.map((c) => ({ wch: c.type === "text" ? 26 : 16 }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, report.title.slice(0, 31));
  const out = XLSX.write(book, { type: "array", bookType: "xlsx", cellDates: true }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function reportFilename(report: Report, extension: "csv" | "xlsx"): string {
  const period = report.period ? `${report.period.from}_${report.period.to}` : "as-of-today";
  return `${report.id}_${period}.${extension}`;
}

/** Display text for a cell on screen (the table component uses this). */
export function displayCell(value: ReportCell, column: ReportColumn, currencyFormat: (n: number) => string): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (column.type === "money") return currencyFormat(value);
    if (column.type === "percent") return `${value}%`;
    return String(value);
  }
  return column.type === "date" ? formatDate(value) : value;
}
