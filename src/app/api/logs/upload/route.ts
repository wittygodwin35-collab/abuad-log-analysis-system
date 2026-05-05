import { NextRequest, NextResponse } from 'next/server';
import { createAndAnalyzeLogFile } from '@/lib/analysis-storage';

export const runtime = 'nodejs';

// POST - Upload and analyze log file
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Read file content
    const content = await file.text();

    const analysis = await createAndAnalyzeLogFile({
      originalName: file.name,
      fileSize: file.size,
      content,
      source: 'upload',
    });

    return NextResponse.json({
      logFile: analysis.logFile,
      summary: analysis.summary,
      pipeline: analysis.pipeline,
    });
  } catch (error) {
    console.error('Error uploading log file:', error);
    return NextResponse.json(
      { error: 'Failed to upload and analyze log file' },
      { status: 500 }
    );
  }
}
