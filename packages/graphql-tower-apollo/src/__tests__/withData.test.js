/**
 * @jest-environment jsdom
 */
import _ from 'lodash';
import React from 'react';
import PropTypes from 'prop-types';
import http from 'http';
import gql from 'graphql-tag';
import express from 'express';
import ws from 'ws';
import bodyParser from 'body-parser';
import { subscribe, GraphQLID, GraphQLString, GraphQLSchema, GraphQLObjectType } from 'graphql';
import { PubSub } from 'graphql-subscriptions';
import { SubscriptionServer } from 'subscriptions-transport-ws';
import { render } from 'enzyme';
import { graphql } from 'react-apollo';
import { execute } from 'apollo-link';
import { graphqlExpress } from 'apollo-server-express';
import { Query } from 'graphql-tower-queries';
import { withData, initApollo } from '../';
import localStorage from '../localStorage';

jest.unmock('node-fetch');

const pubsub = new PubSub();

const renewToken = jest.fn();
const resolveSpy = jest.fn(payload => payload * 2);
const subscribeSpy = jest.fn(() => pubsub.asyncIterator('me'));

const User = new GraphQLObjectType({
  name: 'User',
  fields: {
    id: { type: GraphQLID },
    name: { type: GraphQLString },
  },
});

const Me = class extends Query {
  type = User;
  resolve = resolveSpy;
  subscribe = subscribeSpy;
};

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({ name: 'Query', fields: { me: new Me() } }),
  subscription: new GraphQLObjectType({ name: 'Subscription', fields: { me: new Me() } }),
});

const app = express();
app.use('/graphql', bodyParser.json(), graphqlExpress((req, res) => {
  const token = renewToken();
  if (token) {
    res.append('X-Refresh-Token', token);
    res.append('Authorization', token);
  }

  const context = {};
  if (req.headers['x-hackers']) context['x-hackers'] = req.headers['x-hackers'];
  if (req.headers.authorization) context.authorization = req.headers.authorization;

  return { schema, context };
}));

const server = http.createServer(app);
server.listen();
const { port } = server.address();

new SubscriptionServer( // eslint-disable-line
  {
    schema, subscribe, execute, onConnect: params => (params : {}),
  },
  { server, path: '/' },
);

class App extends React.Component {
  static propTypes = {
    value: PropTypes.number,
    data: PropTypes.shape(),
  }

  static defaultProps = {
    value: 0,
    data: {},
  }

  static async getInitialProps() {
    return { value: 99 };
  }

  render() {
    const { value, data } = this.props;
    const me = data.me || {};

    return (<div>{me.id}-{me.name} value: {value}</div>);
  }
}

const apollo = {
  httpUri: `http://localhost:${port}/graphql`,
  wsUri: `ws://localhost:${port}/`,
  webSocketImpl: ws,
};

describe('withData', () => {
  describe('process.browser is false', () => {
    beforeEach(() => { process.browser = false; });

    it('when NoSSR', async () => {
      const WrapApp = withData({ ...apollo, noSSR: true })(graphql(gql`query { me { id name } }`)(App));

      const props = await WrapApp.getInitialProps();
      expect(props).toMatchSnapshot();
      expect(resolveSpy).toHaveBeenCalledTimes(0);

      const component = render(<WrapApp {...props} />);
      expect(component).toMatchSnapshot();
    });

    it('getInitialProps without cookie', async () => {
      resolveSpy.mockReturnValueOnce(Promise.resolve({ id: '50', name: 'hello' }));
      const WrapApp = withData(apollo)(graphql(gql`query { me { id name } }`)(App));

      const props = await WrapApp.getInitialProps();
      expect(props).toMatchSnapshot();

      expect(resolveSpy)
        .toHaveBeenLastCalledWith(undefined, {}, { authorization: undefined }, expect.anything());
      expect(resolveSpy).toHaveBeenCalledTimes(1);

      const component = render(<WrapApp {...props} />);
      expect(component).toMatchSnapshot();
    });

    it('getInitialProps with cookie', async () => {
      resolveSpy.mockReturnValueOnce(Promise.resolve({ id: '50', name: 'hello' }));
      const WrapApp = withData(apollo)(graphql(gql`query { me { id name } }`)(App));

      const props = await WrapApp.getInitialProps(_.set({}, ['req', 'headers', 'cookie'], 'access_token=key of token'));
      expect(props).toMatchSnapshot();
      expect(resolveSpy)
        .toHaveBeenLastCalledWith(undefined, {}, { authorization: 'Bearer key of token' }, expect.anything());
      expect(resolveSpy).toHaveBeenCalledTimes(1);

      const component = render(<WrapApp {...props} />);
      expect(component).toMatchSnapshot();
    });

    it('when throw error', async () => {
      resolveSpy.mockReturnValueOnce(Promise.resolve(new Error()));
      const WrapApp = withData(apollo)(graphql(gql`query { me { id name } }`)(App));

      const props = await WrapApp.getInitialProps();
      expect(props).toMatchSnapshot();
      expect(resolveSpy)
        .toHaveBeenLastCalledWith(undefined, {}, { authorization: undefined }, expect.anything());
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it('when no getInitialProps', async () => {
      resolveSpy.mockReturnValueOnce(Promise.resolve({ id: '50', name: 'hello' }));
      const WrapApp = withData(apollo)(graphql(gql`query { me { id name } }`)(() => <div />));
      expect(await WrapApp.getInitialProps()).toMatchSnapshot();
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('process.browser is true', () => {
    beforeEach(() => {
      process.browser = true;
      initApollo.client = null;
    });

    it('getInitialProps', async () => {
      const WrapApp1 = withData(apollo)(graphql(gql`query { me { id name } }`)(App));
      expect(await WrapApp1.getInitialProps()).toMatchSnapshot();

      const WrapApp2 = withData(apollo)(graphql(gql`query { me { id name } }`)(App));
      expect(await WrapApp2.getInitialProps()).toMatchSnapshot();

      expect(resolveSpy).toHaveBeenCalledTimes(0);
    });

    it('has not websocket', async () => {
      const WrapApp = withData({ ...apollo, wsUri: undefined })(graphql(gql`query { me { id name } }`)(App));
      expect(await WrapApp.getInitialProps()).toMatchSnapshot();
      expect(resolveSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('initApollo', () => {
    beforeEach(() => {
      process.browser = true;
      initApollo.client = null;
    });

    it('init', async () => {
      expect(initApollo()).toMatchSnapshot();
      expect(initApollo()).toBe(initApollo());
      expect(initApollo().authorized).toBe(false);
    });

    it('subscription', async () => {
      let resolve;
      const promise = new Promise((__) => { resolve = __; });
      subscribeSpy.mockImplementationOnce(resolve);

      const client = initApollo({}, { ...apollo, authorization: 'key of token' });
      execute(client.link, { query: gql`subscription { me { id name } }` }).subscribe({});

      await promise;

      expect(subscribeSpy).toHaveBeenLastCalledWith(undefined, {}, { authorization: 'key of token' }, expect.anything());
      expect(subscribeSpy).toHaveBeenCalledTimes(1);
      expect(client.authorized).toBe(true);
    });

    it('query', async () => {
      renewToken.mockReturnValueOnce('new token');

      let resolve;
      const promise = new Promise((__) => { resolve = __; });
      resolveSpy.mockImplementationOnce(resolve);

      const client = initApollo({}, { ...apollo, authorization: 'key of token' });
      execute(client.link, { query: gql`query { me { id name } }` }).subscribe({});
      await promise;

      expect(resolveSpy).toHaveBeenLastCalledWith(undefined, {}, { authorization: 'key of token' }, expect.anything());
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it('headers', async () => {
      let resolve;
      const promise = new Promise((__) => { resolve = __; });
      resolveSpy.mockImplementationOnce(resolve);

      const client = initApollo({}, { ...apollo, headers: () => ({ 'x-hackers': '999' }) });
      execute(client.link, { query: gql`query { me { id name } }` }).subscribe({});
      await promise;

      expect(resolveSpy).toHaveBeenLastCalledWith(undefined, {}, { 'x-hackers': '999' }, expect.anything());
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it('authorization', async () => {
      localStorage.setItem = jest.fn();
      renewToken.mockReturnValueOnce('new token');

      const client = initApollo({}, apollo);

      let resolve1;
      const promise1 = new Promise((__) => { resolve1 = __; });
      resolveSpy.mockImplementationOnce(resolve1);
      execute(client.link, { query: gql`query { me { id name } }` }).subscribe({});

      await promise1;

      await new Promise(setImmediate);
      await new Promise(setImmediate);

      let resolve2;
      const promise2 = new Promise((__) => { resolve2 = __; });
      resolveSpy.mockImplementationOnce(resolve2);
      execute(client.link, { query: gql`query { me { id name } }` }).subscribe({});

      await promise2;

      await new Promise(setImmediate);
      await new Promise(setImmediate);

      expect(resolveSpy)
        .toHaveBeenCalledWith(undefined, {}, { authorization: undefined }, expect.anything());
      expect(resolveSpy)
        .toHaveBeenCalledWith(undefined, {}, { authorization: 'Bearer new token' }, expect.anything());
      expect(resolveSpy).toHaveBeenCalledTimes(2);
      expect(localStorage.setItem).toHaveBeenLastCalledWith('graphql-tower-token', 'new token');
      expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    });
  });
});
