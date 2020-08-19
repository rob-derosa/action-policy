# :running: Action Policy 

This GitHub action allows you to provide a list of actions allowed or prohibited to be enforced within this repository. If a code push or pull request contains changes to a workflow `yaml` file containing a reference to an action that violates the action policy, a `violations` output value is set containing an array of the offending actions in JSON format.

### Actions can be added to the policy by:
* Author
* Author/Action
* Author/Action@Ref 


## :dart: Usage

Create a `.github/workflows/enforce-action-policy.yml` file:

```yaml
name: "Enforce Action Policy"
on:
  push:
  pull_request:
    types:
      - opened
      - edited
jobs:
  enforce-action-policy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: rob-derosa/action-policy@v1
        name: "Check for action policy violations"
        id: action-policy
        with:
          policy: prohibit
          policy-url: "https://mycompanywebsite.com/security/prohibit_policy.json"
          fail-if-violations: false
          github-token: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/github-script@v2
        name: "Respond to action policy violations"
        with:
          github-token: ${{secrets.GITHUB_TOKEN}}
          violations: ${{steps.action-policy.outputs.violations}}
          script: |
            const script = require(`${process.env.GITHUB_WORKSPACE}/.github/workflows/action_violation.js`)
            await script({github, context, core})
```

Sample content of `prohibit_policy.json`
```json
{
  "actions" : [
    "externaldev/some-neat-action@v2",
    "badactor/give-me-your-data@v4.3b",
    "staleauthor/out-of-date-action@*",
    "untrustedauthor/*" ]
}
```

## :pencil: Configuration

The following inputs are required:

- `policy`: Provide either `allow` to treat the policy as an allow list or `prohibit` to treat it as a prohibit list
- `policy-url`: The remote URL of the policy.json file containing a list of actions and versions allowed or prohibited ([see sample payload](#sample-content-of-action-policy-allowjson))
- `fail-if-violations`: set to false if you want this action to refrain from setting the status of this action to **fail** - this allows downstream actions to run
- `github-token`: leave this be :metal: - needed to access the added or modified files


## :warning: Responding to Policy Violations

Note that this action only checks to see if action violations are detected and writes that data to the `violations` output. In this sample,
we use a downstream action to respond to any violations that occur. By using the `actions/github-script@v2` action, we can execute
Javascript directly in the yaml workflow. Even cleaner, we can consolidate that logic in it's own file and call it from the yaml workflow.

```yaml
steps:
  ...
  - uses: actions/github-script@v2
    name: "Respond to action policy violations"
    with:
      github-token: ${{secrets.GITHUB_TOKEN}}
      violations: ${{steps.action-policy.outputs.violations}}
      script: |
        const script = require(`${process.env.GITHUB_WORKSPACE}/.github/workflows/action_violation.js`)
        await script({github, context, core})
```

Here, we are executing logic contained in the [.github/workflows/action_violation.js](.github/workflows/action_violation.js) file.
If a a violation occurs:
* triggered by code push
  * an issue will be created, labeled with `Action Policy Violation`, containing a link to the commit, and assigned to the user pushing the code
* triggered by pull request being opened or updated
  * the pull request will be labeled with `Action Policy Violation` and a comment is added with violation details

Keeping the response to the violations in a separate step but in its own Javascript file allows for maximum flexibility on how
you choose to respond while still providing access to context, core, octokit, io and keeping your yaml nice and tidy.


## :boom: In Action

**A commit was made that included an update to a workflow file.**
![Action Console Log](assets/action_log.png?raw=true)

**Because a violation was detected, a comment is added to the pull request and labeled. If triggered by a code push, a new issue is created and assigned to the user who pushed the code.**
![Pull request commented on due to violation](assets/pull_request.png?raw=true)


### Improvements

* provide support for ignore path filters to allow ignoring specific workflow files

### License

MIT