import dotenv from 'dotenv'
import chalk from 'chalk';
import fs from 'fs';

dotenv.config();

import {Octokit} from "octokit";

const fileName = 'output.json';
const log = console.log;
const running = chalk.hex('#09b0dc');
const warning = chalk.hex('#ffc45a');
const error = chalk.hex('#fa122d');
const success = chalk.hex('#50db14');

const accessToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const repo = process.env.GITHUB_REPO;
const owner = process.env.GITHUB_OWNER;
const octokit = new Octokit({auth: accessToken});

const expireYEar = new Date().setMonth(new Date().getMonth() - 6);
const expirationDate = new Date(expireYEar).getTime();

import {bugIDs} from './bugs.js';


const {data: {login}} = await octokit.rest.users.getAuthenticated();
log(success(`Hello %s!`), login);

async function* fetchRequest(url) {// will pause the execution
  yield await octokit.request(url);
}

const requestIterator = async (url) => {
  log(warning(`http request ${url}`));
  const iterator = fetchRequest(url);
  return await iterator.next();
}

const pollPRs = async (page, per_page) => {
  const files = [];
  let hasData = true;
  let expiredFlag = false;
  let prs = [];
  while (hasData && !expiredFlag) {
    const url = `GET /repos/${owner}/${repo}/pulls?per_page=${per_page}&page=${page}&state='closed'`;
    const iterator = fetchRequest(url);
    const {value, done} = await iterator.next();
    const partial_data = value.data;
    const hasData = partial_data.length;
    if (!hasData) {
      log(warning(`No pull requests any more. The last result is ${files.length} files`));
    }
    const date = new Date(partial_data[0].merged_at).getTime();
    expiredFlag = expirationDate > date;
    if (expiredFlag) {
      log(error(`Reached expiration date ${new Date(expirationDate).getDate()} with ${prs.length} files`));
    }
    const bugs = filterBugs(partial_data);
    if (bugs) {
      prs.push(...bugs);
    }
    page++;
  }
  const prFiles = await pollPrFiles(prs, 1, 100);
  files.push(...prFiles);
  log(success(`Fetched ${files.length} files from pull requests...`));
  return files;
}

const filterBugs = (partial_data) => {
  const regexPattern = RegExp(/NVIEW-.*[/^\d+$/]/);
  return partial_data.filter(pr => {
    const result = pr.title.match(regexPattern);
    if (!result) {
      return pr;
    }
    return bugIDs.includes(result[0]);
  });
}

const mapFiles = (pr, files) => {
  return files.map(file => {
    const pullRequestObj = {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
      created_at: pr.created_at,
      merged_at: pr.merged_at,
      merge_commit_sha: pr.merge_commit_sha,
      labels: pr.labels.map(label => {
        return {
          name: label.name,
          description: label.description
        }
      }),
      head: {
        label: pr.head.label,
        sha: pr.head.sha
      },
      base: {
        label: pr.base.label,
        sha: pr.base.sha
      },
      user: {
        login: pr.user.login
      }
    }

    return {...file, pull: pullRequestObj}
  });
}

const pollPrFiles = async (pullRequests, page, per_page) => {
  let prFiles = [];
  let index = 0;
  while (index < pullRequests.length) {
    const pr = pullRequests[index];
    const url = `GET /repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=${per_page}&page=${page}`;
    const {value, done} = await requestIterator(url);
    const filesWithPr = mapFiles(pr, value.data);
    prFiles.push(...filesWithPr);
    log(running(`pulled files ..${prFiles.length}`));
    index++;
  }
  return prFiles;
}

const writeDoc = (fileName, data) => {
  const jsonContent = JSON.stringify(data);
  fs.writeFile(fileName, jsonContent, 'utf8', (err) => {
    if (err) {
      return log(error('An error occurred while writeDoc()'));
    }
    return log(success('JSON file has been saved'));
  });
}

const groupBy = (data) => {
  return data.reduce((res, file) => {
    const filename = file['filename'];
    res[filename] = filename || [];
    res[filename].push(file.pull.title);
    return res;
  }, {});
}


log(running(`Running script...`));
const files = await pollPRs(1, 100);
const data = groupBy(files);
await writeDoc(fileName, data);
log(success(`Fetched ${files.length} files`));
