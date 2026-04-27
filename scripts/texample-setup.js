import Mocha from 'mocha';

process.env.APPLICATIONINSIGHTS_CONNECTION_STRING =
  'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://ingestion.local';

const mocha = new Mocha({ ui: 'bdd', reporter: 'min' });
mocha.suite.emit('pre-require', globalThis, 'mocha-example', mocha);

globalThis.runMocha = () =>
  new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} mocha test(s) failed`)) : resolve()));
  });
