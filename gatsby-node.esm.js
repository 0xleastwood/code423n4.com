import path from "path";
import SchemaCustomization from "./schema";
import { createFilePath } from "gatsby-source-filesystem";
import { Octokit } from "@octokit/core";
import { graphql } from "@octokit/graphql";
const { token } = require("./functions/_config");

const octokit = new Octokit({
  auth: token,
});
const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `Bearer ${token}`,
  },
});

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^\w\-]+/g, "") // Remove all non-word chars
    .replace(/\-\-+/g, "-") // Replace multiple - with single -
    .replace(/^-+/, "") // Trim - from start of text
    .replace(/-+$/, ""); // Trim - from end of text
}

function contestSlug(contestNode) {
  const startDate = new Date(contestNode.start_time);
  const year = startDate.getFullYear();
  const month = `${startDate.getMonth() + 1}`.padStart(2, "0");
  const title = slugify(contestNode.title);
  const slug = `${year}-${month}-${title}`;

  return slug;
}

function contestPermalink(contestNode) {
  return `/contests/${contestSlug(contestNode)}`;
}

function contestSubmissionPermalink(contestNode) {
  return `/contests/${contestSlug(contestNode)}/submit`;
}

function contestArtworkPermalink(contestNode) {
  const fs = require("fs");
  const slug = contestSlug(contestNode);
  const path = `static/images/contests/${slug}.jpg`;
  if (fs.existsSync(path)) {
    // found the image
    return `/images/contests/${slug}.jpg`;
  } else {
    console.warn("[MISSING IMAGE]:", path);
    return null;
  }
}

function getRepoName(contestNode) {
  const regex = "([^/]+$)";
  const url = contestNode.repo;

  const result = url.match(regex);
  const repoName = result[0];
  return repoName;
}

async function fetchReadmeMarkdown(contestNode) {
  const { data } = await octokit.request("GET /repos/{owner}/{repo}/readme", {
    owner: "code-423n4",
    repo: `${getRepoName(contestNode)}`,
    headers: {
      accept: "application/vnd.github.v3.html+json",
    },
  });

  return data;
}

async function fetchSocialImage(contestNode) {
  const { repository } = await graphqlWithAuth(
    `query socialImage($repo: String!) {
    repository(owner: "code-423n4", name: $repo) {
      openGraphImageUrl
      usesCustomOpenGraphImage
    }
  }`,
    {
      repo: getRepoName(contestNode),
    }
  );
  if (repository.usesCustomOpenGraphImage) {
    return repository.openGraphImageUrl;
  }

  return null;
}

const queries = {
  contests: `query {
    contests: allContestsCsv(sort: { fields: end_time, order: ASC }) {
      edges {
        node {
          id
          contestid
          title
          start_time(formatString: "YYYY-MM")
          findingsRepo
          fields {
            submissionPath
            contestPath
            readmeContent
            artPath
          }
        }
      }
    }
  }
`,
};

exports.createSchemaCustomization = ({ actions }) => {
  const { createTypes } = actions;
  try {
    createTypes(SchemaCustomization);
  } catch (error) {
    console.log(error);
  }
};

exports.onCreateNode = async ({ node, getNode, actions }) => {
  const { createNodeField } = actions;
  if (node.internal.type === `MarkdownRemark`) {
    const value = createFilePath({ node, getNode });
    const parent = getNode(node.parent);
    let slug;
    if (node.frontmatter.slug) {
      // if a slug is defined, use that.
      slug = "/" + node.frontmatter.slug;
    } else {
      // otherwise use the file path
      slug = createFilePath({ node, getNode });
    }
    createNodeField({
      node,
      name: `collection`,
      value: parent.sourceInstanceName,
    });

    createNodeField({
      node,
      name: `slug`,
      value: slug,
    });
  }

  if (node.internal.type === `ContestsCsv`) {
    createNodeField({
      node,
      name: `contestPath`,
      value: contestPermalink(node),
    });

    createNodeField({
      node,
      name: `submissionPath`,
      value: contestSubmissionPermalink(node),
    });

    const readmeMarkdown = await fetchReadmeMarkdown(node);
    createNodeField({
      node,
      name: `readmeContent`,
      value: readmeMarkdown,
    });

    const socialImageUrl = await fetchSocialImage(node);
    createNodeField({
      node,
      name: `artPath`,
      value: socialImageUrl,
    });
  }
};

exports.createPages = async ({ graphql, actions }) => {
  const { createPage } = actions;

  let contests = await graphql(queries.contests);
  const formTemplate = path.resolve("./src/layouts/ReportForm.js");
  const contestTemplate = path.resolve("./src/layouts/ContestLayout.js");
  contests.data.contests.edges.forEach((contest) => {
    if (contest.node.findingsRepo) {
      createPage({
        path: contest.node.fields.submissionPath,
        component: formTemplate,
        context: {
          contestId: contest.node.contestid,
        },
      });
    }

    createPage({
      path: contest.node.fields.contestPath,
      component: contestTemplate,
      context: {
        contestId: contest.node.contestid,
      },
    });
  });
};
