import {readFile} from 'node:fs/promises';

const clone = value => structuredClone(value);

const LINKEDIN_HTML = await readFile(new URL('./linkedin.html', import.meta.url), 'utf8');

export const FIXTURE_ACCOUNT = 'member-fixture-a';

export const fixtureData = Object.freeze({
  // Mirrors the real salesApiMe response shape (verified against a live
  // capture): entityUrn is not a plain identifier and must be parsed;
  // vanityName is the simplest reliable binding candidate.
  identity: {
    firstName: 'Fixture', lastName: 'Member', vanityName: FIXTURE_ACCOUNT,
    entityUrn: 'urn:li:fs_salesProfile:(ACwFIXTURE00000000000000000000, , )',
  },
  ssi: {
    memberScore: {overall: 51, subScores: [{score: 13}, {score: 12}, {score: 14}, {score: 12}]},
    groupScore: [
      {groupType: 'INDUSTRY', rank: 11, groupSize: 100, industry: 'Technology', score: {overall: 49, subScores: [{score: 12}, {score: 11}, {score: 14}, {score: 12}]}},
      {groupType: 'NETWORK', rank: 9, groupSize: 200, score: {overall: 55, subScores: [{score: 14}, {score: 13}, {score: 15}, {score: 13}]}},
    ],
    rawSecret: '<html>must never persist</html>',
  },
  analytics: {followers: 1200, connections: 500, profileViews: 80, searchAppearances: 12, impressions: 2400, engagements: 93},
  profile: {sections: {headline: {status: 'complete', length: 82}, about: {status: 'weak', length: 120}}, debug: {pageText: 'private'}},
  jobs: [{id: '123', title: '<img src=x onerror=alert(1)>Engineer', company: 'Example', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/123', logoUrl: 'https://media.licdn.com/logo.png', postedTime: '1 day ago', remote: true}],
});

export function createFixtureRouter(options = {}) {
  const state = {
    status: options.status ?? 200,
    delay: options.delay ?? 0,
    accountBinding: options.accountBinding ?? FIXTURE_ACCOUNT,
    malformed: options.malformed ?? false,
    requireCsrfToken: options.requireCsrfToken ?? false,
    requests: [],
  };

  const API_PATH = /\/voyager\/api\/me$|salesApiMe|salesApiSsi|\/analytics|\/identity\/profiles\/|\/jobs\//;

  async function route(request) {
    state.requests.push({url: request.url.href, method: request.method, headers: request.headers});
    if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
    const path = request.url.pathname;
    if (state.requireCsrfToken && API_PATH.test(path) && !request.headers?.['csrf-token']) {
      return {status: 403, body: {error: 'missing_csrf_token'}};
    }
    if (state.status !== 200) return {status: state.status, body: {error: 'fixture_error'}};
    if (state.malformed) return {status: 200, body: '{malformed', contentType: 'application/json'};
    if (path.endsWith('/voyager/api/me') || path.includes('salesApiMe')) {
      return {body: {...clone(fixtureData.identity), vanityName: state.accountBinding}};
    }
    if (path.includes('salesApiSsi')) return {body: clone(fixtureData.ssi)};
    if (path.includes('/analytics')) return {body: clone(fixtureData.analytics)};
    if (path.includes('/identity/profiles/')) return {body: clone(fixtureData.profile)};
    if (path.includes('/jobs/')) return {body: clone(fixtureData.jobs)};
    return {contentType: 'text/html', body: LINKEDIN_HTML};
  }

  return {state, route};
}
