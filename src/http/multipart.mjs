import path from 'node:path';

function parseContentDisposition(headerValue) {
  const result = {
    name: null,
    filename: null,
  };

  const nameMatch = headerValue.match(/name="([^"]+)"/i);
  if (nameMatch) {
    result.name = nameMatch[1];
  }

  const fileMatch = headerValue.match(/filename="([^"]*)"/i);
  if (fileMatch) {
    result.filename = path.basename(fileMatch[1]);
  }

  return result;
}

function parseHeaders(headerText) {
  const headers = {};
  for (const line of headerText.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[key] = value;
  }
  return headers;
}

function sliceBetween(buffer, start, end) {
  if (start >= end) {
    return Buffer.alloc(0);
  }
  return buffer.subarray(start, end);
}

export function parseMultipartBody(bodyBuffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) {
    throw new Error('Boundary multipart tidak ditemukan.');
  }

  const boundary = `--${boundaryMatch[1]}`;
  const boundaryBuffer = Buffer.from(boundary);
  const fields = {};
  const files = {};

  let cursor = 0;
  while (cursor < bodyBuffer.length) {
    const start = bodyBuffer.indexOf(boundaryBuffer, cursor);
    if (start === -1) {
      break;
    }

    const partStart = start + boundaryBuffer.length;
    const isFinalBoundary = bodyBuffer[partStart] === 45 && bodyBuffer[partStart + 1] === 45;
    if (isFinalBoundary) {
      break;
    }

    let contentStart = partStart;
    if (bodyBuffer[contentStart] === 13 && bodyBuffer[contentStart + 1] === 10) {
      contentStart += 2;
    }

    const nextBoundary = bodyBuffer.indexOf(boundaryBuffer, contentStart);
    if (nextBoundary === -1) {
      break;
    }

    let partBuffer = sliceBetween(bodyBuffer, contentStart, nextBoundary);
    if (partBuffer.length >= 2 && partBuffer[partBuffer.length - 2] === 13 && partBuffer[partBuffer.length - 1] === 10) {
      partBuffer = partBuffer.subarray(0, partBuffer.length - 2);
    }

    const headerEnd = partBuffer.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) {
      cursor = nextBoundary;
      continue;
    }

    const headersText = partBuffer.subarray(0, headerEnd).toString('utf8');
    const content = partBuffer.subarray(headerEnd + 4);
    const headers = parseHeaders(headersText);

    const disposition = headers['content-disposition'];
    if (!disposition) {
      cursor = nextBoundary;
      continue;
    }

    const details = parseContentDisposition(disposition);
    if (!details.name) {
      cursor = nextBoundary;
      continue;
    }

    if (details.filename !== null) {
      files[details.name] = {
        filename: details.filename,
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: Buffer.from(content),
      };
    } else {
      fields[details.name] = content.toString('utf8');
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}
