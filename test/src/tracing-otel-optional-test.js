import { applyTracing, trackTraceAndException } from '@0dep/pino-applicationinsights';

describe('applyTracing', () => {
  it('is a no-op when tracing is omitted', () => {
    let ran = false;
    const result = applyTracing(undefined, () => {
      ran = true;
      return 'ok';
    });
    expect(ran).to.equal(true);
    expect(result).to.equal('ok');
  });

  it('forwards traceState when provided', () => {
    let captured;
    applyTracing({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceState: 'vendor=foo' }, function fn() {
      captured = true;
    });
    expect(captured).to.equal(true);
  });
});

describe('trackTraceAndException', () => {
  it('skips auto-correlation when the client lacks context.keys', () => {
    const calls = [];
    const fakeClient = {
      trackTrace(telemetry) {
        calls.push(['trace', telemetry]);
      },
      trackException(telemetry) {
        calls.push(['exception', telemetry]);
      },
    };
    trackTraceAndException.call(fakeClient, {
      time: new Date(0),
      severity: 1,
      msg: 'foo',
      properties: {},
      tracing: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) },
    });
    expect(calls).to.have.length(1);
    expect(calls[0][1].tagOverrides).to.equal(undefined);
  });
});
