-- 通知目标和管理权限独立保存。仅迁移旧版的个人私聊绑定。
ALTER TABLE base_config ADD COLUMN admin_user_ids TEXT NOT NULL DEFAULT '';

UPDATE base_config
SET admin_user_ids = trim(chat_id)
WHERE trim(chat_id) <> ''
    AND trim(chat_id) NOT GLOB '*[^0-9]*'
    AND substr(trim(chat_id), 1, 1) BETWEEN '1' AND '9'
    AND CAST(trim(chat_id) AS INTEGER) BETWEEN 1 AND 9007199254740991;
