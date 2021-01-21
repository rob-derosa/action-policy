import * as core from "@actions/core";
import * as github from "@actions/github";
import fetch from "node-fetch";
import fs from "fs";
import * as ghf from "./github_files";
import yamlParse from "js-yaml"
import path from "path";

export class Action {

  constructor(actionString: string) {
    actionString = actionString.toLowerCase();
    let as = actionString.split('/');
    this.author = as[0];

    let action = as[1].split('@');
    this.name = action[0];
    this.ref = (action.length > 1) ? action[1] : "*";
  }

  
  toString(): string {
    return `${this.author}/${this.name}@${this.ref}`;
  }

  author: string;
  name: string;
  ref: string;
}

export interface Workflow {
  filePath: string;
  actions: Array<Action>;
}

async function run(): Promise<void> {
  try {
    const line = "-------------------------------------------";
    // const args = process.argv.slice(2);
    // const policyType = args[0];
    // const policyUrl = args[1]
    // const gitHubToken = args[2];
    // const failIfViolations = false

    const er = new RegExp('^\\s*(\\s*/[*].*[*]/\\s*)*\\}|^\\s*(\\s*/[*].*[*]/\\s*)*\\)|^\\s*(public|private|protected):\\s*$|^\\s*@(public|private|protected)\\s*$');
    const policyType = core.getInput("policy", { required: true })
    const policyUrl = core.getInput("policy-url", { required: true })
    const gitHubToken = core.getInput("github-token", { required: true })
    const failIfViolations = core.getInput("fail-if-violations", { required: false }) == "true"

    if (!policyType || (policyType != "allow" && policyType != "prohibit"))
      throw new Error("policy must be set to 'allow' or 'prohibit'");

    if (!policyUrl)
      throw new Error("policy-url not set");

    const client = github.getOctokit(gitHubToken);

    //get all the modified or added files in the commits
    let allFiles = new Set<string>();
    let commits;

    switch (github.context.eventName) {
      case "pull_request":
        let url = github.context.payload.pull_request?.commits_url;
        const args = { owner: github.context.repo.owner, repo: github.context.repo.repo };
        commits = await client.paginate(`GET ${url}`, args);
        break;
      case "push":
        commits = github.context.payload.commits.filter((c: any) => c.distinct);
        break;
      default:
        commits = [];
    }

    commits = commits.filter((c: any) => !c.parents || 1 === c.parents.length);

    for (let i = 0; i < commits.length; i++) {
      var f = await ghf.getFilesInCommit(commits[i], core.getInput('github-token'));
      f.forEach(element => allFiles.add(element));
    }

    // console.log("FILES ADDED or MODIFIED")
    // allFiles.forEach((f: string) => {
    //   console.log(f);
    // });

    let actionPolicyList = new Array<Action>();
    let actionViolations = new Array<Workflow>();
    let workflowFiles = new Array<Workflow>();
    let workflowFilePaths = new Array<string>();

    //look for any workflow file updates
    allFiles.forEach((file) => {
      let filePath = path.parse(file);

      //console.log(filePath);
      if ((filePath.ext.toLowerCase() == ".yaml" || filePath.ext.toLowerCase() == ".yml") &&
        filePath.dir.toLowerCase() == ".github/workflows") {
        workflowFilePaths.push(file);
      }
    });

    //No workflow updates - byeee!
    if (workflowFilePaths.length == 0) {
      console.log("No workflow files detected in change set.")
      return;
    }

    //Load up the remote policy list
    await fetch(policyUrl)
      .then(function (response) {
        return response.json();
      })
      .then(function (json) {
        let actions: string[] = json.actions;

        actions.forEach(as => {
          actionPolicyList.push(new Action(as));
        });
      });

    console.log("\nACTION POLICY LIST");
    console.log(line);
    actionPolicyList.forEach((item) => {
      console.log(item.toString());
    });

    workflowFilePaths.forEach(wf => {
      let workflow: Workflow = { filePath: wf, actions: Array<Action>() };
      workflowFiles.push(workflow);

      try {
        let yaml: any = yamlParse.safeLoad(fs.readFileSync(workflow.filePath, "utf-8"));
        let actionStrings = getPropertyValues(yaml, "uses")

        actionStrings.forEach(as => {
          workflow.actions.push(new Action(as));
        });
      } catch (error) {
        console.log(error);
        core.debug(error.message);
        core.setFailed(`Unable to parse workflow file '${workflow.filePath}' - please ensure it's formatted properly.`)
      }
    });

    //iterate through all the workflow files found
    workflowFiles.forEach((workflow: Workflow) => {

      console.log(`\nEvaluating '${workflow.filePath}'`);
      console.log(line);

      let violation: Workflow = { filePath: workflow.filePath, actions: Array<Action>() };
      workflow.actions.forEach((action: Action) => {
        console.log(` - ${action.toString()}`);

        if (action.author == ".")
          return;

        let match = actionPolicyList.find(policy => policy.author === action.author &&
          (policy.name === "*" || action.name === policy.name) &&
          (policy.ref === "*" || action.ref == policy.ref));

        if (policyType == "allow") {
          if (!match) {
            violation.actions.push(action);
          }
        } else if (policyType == "prohibit") {

          if (match) {
            violation.actions.push(action);
          }
        }
      });

      if (violation.actions.length > 0) {
        actionViolations.push(violation);
      } else {
        console.log("\nNo violations detected");
      }
    });

    if (actionViolations.length > 0) {
      core.setOutput("violations", actionViolations);
      console.log("\n!!! ACTION POLICY VIOLATIONS DETECTED !!!");
      console.log(line);

      actionViolations.forEach(workflow => {
        console.log(`Workflow: ${workflow.filePath}`);

        workflow.actions.forEach(action => {
          console.log(` - ${action.toString()}`);
        });

        console.log();
      });

      if (failIfViolations) {
        core.setFailed("!!! ACTION POLICY VIOLATIONS DETECTED !!!");
      }
    } else {
      console.log("\nAll workflow files contain actions that conform to the policy provided.");
    }
  } catch (error) {
    console.log(error);
    core.setFailed(error.message)
  }
}

function getPropertyValues(obj: any, propName: string, values?: string[]): string[] {

  if (!values) values = [];

  for (var property in obj) {
    if (obj.hasOwnProperty(property)) {
      if (typeof obj[property] == "object") {
        getPropertyValues(obj[property], propName, values);
      } else {
        if (property == propName) {
          values.push(obj[property]);
          //console.log(property + "   " + obj[property]);
        }
      }
    }
  }
  return values;
}

run()
