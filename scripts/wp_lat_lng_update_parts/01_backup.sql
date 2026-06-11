SELECT pm.post_id, pm.meta_key, pm.meta_value
FROM wp_postmeta pm
INNER JOIN wp_posts p ON p.ID = pm.post_id
WHERE p.post_type = 'campus' AND p.post_status = 'publish'
  AND pm.meta_key IN ('_lat', '_lng')
ORDER BY pm.post_id, pm.meta_key;
