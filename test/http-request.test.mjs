import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseRequestBody, readBody } from '../src/http/request.mjs';

function createRequest(body, contentType) {
  const req = Readable.from([body]);
  req.headers = {
    host: 'example.test',
    'content-type': contentType,
  };
  req.url = '/api/data/upload';
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

test('parseRequestBody preserves multipart boundary casing for browser uploads', async () => {
  const boundary = '----WebKitFormBoundaryAbCdEf123456';
  const multipartBody = Buffer.from(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="demo.csv"',
      'Content-Type: text/csv',
      '',
      'a,b',
      '1,2',
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );

  const parsed = await parseRequestBody(
    createRequest(multipartBody, `multipart/form-data; boundary=${boundary}`),
  );

  assert.equal(parsed.files.file.filename, 'demo.csv');
  assert.equal(parsed.files.file.contentType, 'text/csv');
  assert.equal(parsed.files.file.buffer.toString('utf8'), 'a,b\r\n1,2');
});

test('parseRequestBody accepts quoted multipart boundary parameters', async () => {
  const boundary = '----WebKitFormBoundaryQuotedAbCd123';
  const multipartBody = Buffer.from(
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="quoted.csv"',
      'Content-Type: text/csv',
      '',
      'x,y',
      '3,4',
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );

  const parsed = await parseRequestBody(
    createRequest(multipartBody, `multipart/form-data; boundary=\"${boundary}\"`),
  );

  assert.equal(parsed.files.file.filename, 'quoted.csv');
  assert.equal(parsed.files.file.buffer.toString('utf8'), 'x,y\r\n3,4');
});

test('parseRequestBody classifies malformed JSON as a 400 client error', async () => {
  await assert.rejects(
    () => parseRequestBody(createRequest(Buffer.from('{"broken"'), 'application/json')),
    (error) => error?.statusCode === 400 && error?.code === 'INVALID_JSON',
  );
});

test('readBody classifies oversized payloads as a 413 client error', async () => {
  await assert.rejects(
    () => readBody(createRequest(Buffer.from('123456', 'utf8'), 'application/json'), 5),
    (error) => error?.statusCode === 413 && error?.code === 'PAYLOAD_TOO_LARGE',
  );
});
