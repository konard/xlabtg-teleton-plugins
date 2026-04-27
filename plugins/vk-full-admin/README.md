# VK Full Admin

VK Full Admin gives Teleton tools for managing a VK personal account and VK communities where the token owner is a moderator, editor, administrator, or creator.

The plugin uses `vk-io` for all VK API and upload calls. Raw tokens are read only through `sdk.secrets`; the runtime cache stores token fingerprints and admin-check metadata, not token values.

## Setup

Install the plugin folder and dependencies:

```bash
cp -r plugins/vk-full-admin ~/.teleton/plugins/
cd ~/.teleton/plugins/vk-full-admin
npm ci --ignore-scripts
```

Configure secrets in the Teleton WebUI or CLI:

```bash
/secret set vk_full_admin vk_user_token "vk1.a...."
/secret set vk_full_admin vk_community_tokens '{"123456":"vk1.a.group-token","789012":"vk1.a.other-token"}'
```

`vk_user_token` is required for personal account tools and for validating that the user has community manager rights. `vk_community_tokens` is a JSON object keyed by community ID without the minus sign. Community write tools require both a valid user token and a matching community token.

## Token Scopes

Recommended user token scopes:

```text
offline, wall, messages, friends, photos, groups, stats, notifications
```

Recommended community token scopes:

```text
manage, messages, photos, docs
```

The helper tools `vk_auth_user_url` and `vk_auth_group_url` build OAuth URLs for these scopes. They do not store tokens.

## Tools

### Authorization

| Tool | Purpose |
| --- | --- |
| `vk_auth_status` | Check configured user and community tokens |
| `vk_auth_user_url` | Build a user-token OAuth URL |
| `vk_auth_group_url` | Build a community-token OAuth URL |
| `vk_group_admin_check` | Validate the token owner's community role |

### Personal Account

| Tool | VK API |
| --- | --- |
| `vk_user_info` | `users.get` |
| `vk_user_messages_send` | `messages.send` |
| `vk_user_wall_post` | `wall.post` |
| `vk_user_friends_list` | `friends.get` |

### Community Content

| Tool | VK API |
| --- | --- |
| `vk_group_wall_post` | `wall.post` |
| `vk_group_wall_edit` | `wall.edit` |
| `vk_group_wall_delete` | `wall.delete` |
| `vk_group_pin_post` | `wall.pin` / `wall.unpin` |
| `vk_group_upload_photo` | `vk.upload.wallPhoto` / `vk.upload.photoAlbum` |
| `vk_group_create_poll` | `polls.create` |

### Moderation

| Tool | VK API |
| --- | --- |
| `vk_group_comment_delete` | `wall.deleteComment` |
| `vk_group_comment_hide_spam` | `wall.reportComment` |
| `vk_group_ban_user` | `groups.ban` |
| `vk_group_unban_user` | `groups.unban` |
| `vk_group_blacklist_list` | `groups.getBanned` |
| `vk_group_clean_wall` | `wall.get` plus guarded `wall.delete` |

### Members And Roles

| Tool | VK API |
| --- | --- |
| `vk_group_members_list` | `groups.getMembers` |
| `vk_group_invite` | `groups.invite` |
| `vk_group_remove` | `groups.removeUser` |
| `vk_group_set_role` | `groups.editManager` |

### Settings And Analytics

| Tool | VK API |
| --- | --- |
| `vk_group_info` | `groups.getById` |
| `vk_group_update_settings` | `groups.edit` |
| `vk_group_update_cover` | `vk.upload.groupCover` |
| `vk_group_update_avatar` | `vk.upload.ownerPhoto` |
| `vk_group_stats` | `stats.get` |
| `vk_group_post_reach` | `wall.getPostReach` |
| `vk_group_audience` | `stats.get` visitors group |

### Community Dialogs

| Tool | VK API |
| --- | --- |
| `vk_group_msg_send` | `messages.send` |
| `vk_group_msg_history` | `messages.getHistory` |
| `vk_group_msg_set_typing` | `messages.setActivity` |

## Safety Model

- Community tools call `groups.isMember` and fall back to `groups.getById` before taking action.
- Roles are enforced by tool impact: moderators for moderation, editors for content and analytics, administrators for settings and manager roles.
- VK API error codes `5`, `7`, `15`, and `260` are normalized for the LLM. Error text is capped at 500 characters and token-like values are redacted.
- A per-token rate gate defaults to 3 requests per second, matching VK limits. API error `260` is retried once.
- `vk_group_clean_wall` defaults to `dry_run: true` and returns the matching posts before deletion.
- Action audit rows are written to the plugin database when `sdk.db` is available.

Automation may violate VK terms or community policies if used carelessly. Use these tools only for communities you are authorized to manage and review destructive actions before running them.

## Examples

Publish a community post:

```json
{
  "owner_id": -123456,
  "message": "New collection is live",
  "attachments": "photo123_456",
  "close_comments": false
}
```

Dry-run wall cleanup:

```json
{
  "owner_id": -123456,
  "filter": "contains",
  "query": "test",
  "count": 20,
  "dry_run": true
}
```

Send a community dialog response:

```json
{
  "group_id": 123456,
  "peer_id": 2000000001,
  "message": "Thanks for contacting support."
}
```

## Local Verification

```bash
node -e "import('./plugins/vk-full-admin/index.js').then(m => console.log(m.tools({secrets:{get:()=>null},pluginConfig:{},log:{debug(){},warn(){},info(){},error(){}}}).length))"
node --test plugins/vk-full-admin/tests/index.test.js
npm run validate
npm run lint
npm test
```
