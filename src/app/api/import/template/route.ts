import { NextResponse, type NextRequest } from 'next/server';
import {
  buildTemplateCsv,
  CSV_DELIMITERS,
  type CsvDelimiterId
} from '@/features/import-catalog/client';

/**
 * Sample import file. No data of anyone's inside, hence no session: a merchant
 * reading the docs before signing up may download it too.
 */
export function GET(req: NextRequest): Response {
  const raw = req.nextUrl.searchParams.get('sep') ?? 'semicolon';
  const delimiter: CsvDelimiterId = raw in CSV_DELIMITERS ? (raw as CsvDelimiterId) : 'semicolon';
  const ext = delimiter === 'tab' ? 'tsv' : 'csv';
  return new NextResponse(buildTemplateCsv(delimiter), {
    headers: {
      'Content-Type':
        delimiter === 'tab'
          ? 'text/tab-separated-values; charset=utf-8'
          : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="oneshoplab-modele-import.${ext}"`,
      'Cache-Control': 'public, max-age=86400'
    }
  });
}
