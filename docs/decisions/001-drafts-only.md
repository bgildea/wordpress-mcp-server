# ADR 001: Write access is limited to creating drafts

**Date:** 2026-11-04 · **Status:** Accepted

## Context

An MCP server gives an AI agent real abilities on a real site. WordPress's REST API can publish, edit and delete content, change settings and manage users. Agents can misread a request, act on instructions hidden in content they read, or simply be wrong with confidence.

## Options

| Option | For | Against |
| --- | --- | --- |
| A. Expose the full REST API | Maximum capability | One bad tool call can delete or publish content on a live site |
| B. Read-only | Zero risk to the site | Loses the most useful writing workflow |
| C. Read tools plus create-as-draft, nothing else | Useful for content work; every change still passes a human | No automated publishing or editing |

## Decision

Option C, with a `WP_READ_ONLY` switch for sites that want option B.

## Why

The value of an assistant on a WordPress site is mostly in reading (what exists, what's out of date) and in drafting. Publishing is a one-click human step that is worth keeping. Drafts are invisible to visitors and easy to delete, so the worst case of a bad call is a draft someone throws away.

## Consequences

- Safe to connect to production sites
- Editing existing posts needs a future tool with its own safeguards, for example writing changes as a new revision or draft copy
- Tool annotations mark every read tool as read-only so clients can apply their own approval rules
