import { applyClientConfig } from '../../src/client-compat.js';

describe('applyClientConfig', () => {
  describe('with a v2-style client (exposes getStatsbeat)', () => {
    function v2Client() {
      const statsbeat = {
        enabled: true,
        enable(state) {
          this.enabled = state;
        },
        isEnabled() {
          return this.enabled;
        },
      };
      return {
        config: { maxBatchSize: 250 },
        getStatsbeat() {
          return statsbeat;
        },
        _statsbeat: statsbeat,
      };
    }

    it('disables statsbeat via getStatsbeat() when config.disableStatsbeat is true', () => {
      const client = v2Client();
      applyClientConfig(client, { disableStatsbeat: true });
      expect(client._statsbeat.isEnabled()).to.be.false;
    });

    it('merges other config keys into client.config', () => {
      const client = v2Client();
      applyClientConfig(client, { maxBatchSize: 1, samplingPercentage: 50 });
      expect(client.config).to.deep.include({ maxBatchSize: 1, samplingPercentage: 50 });
    });

    it('does not touch statsbeat when disableStatsbeat is not set', () => {
      const client = v2Client();
      applyClientConfig(client, { maxBatchSize: 1 });
      expect(client._statsbeat.isEnabled()).to.be.true;
    });
  });

  describe('with a v3-style client', () => {
    it('does not throw when getStatsbeat is missing', () => {
      const client = { config: {} };
      expect(() => applyClientConfig(client, { disableStatsbeat: true })).to.not.throw();
    });

    it('does not throw when getStatsbeat returns null', () => {
      const client = {
        config: {},
        getStatsbeat() {
          return null;
        },
      };
      expect(() => applyClientConfig(client, { disableStatsbeat: true })).to.not.throw();
    });

    it('still merges other config keys into client.config', () => {
      const client = { config: {} };
      applyClientConfig(client, { maxBatchSize: 1 });
      expect(client.config).to.deep.equal({ maxBatchSize: 1 });
    });
  });

  describe('robustness', () => {
    it('is a no-op when config is undefined', () => {
      const client = { config: { maxBatchSize: 250 } };
      applyClientConfig(client, undefined);
      expect(client.config).to.deep.equal({ maxBatchSize: 250 });
    });

    it('does not throw when client.config is missing', () => {
      const client = {};
      expect(() => applyClientConfig(client, { maxBatchSize: 1 })).to.not.throw();
    });
  });
});
