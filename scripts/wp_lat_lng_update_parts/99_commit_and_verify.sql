COMMIT;

SELECT p.ID AS post_id, p.post_title,
  MAX(CASE WHEN pm.meta_key = '_lat' THEN pm.meta_value END) AS latitude,
  MAX(CASE WHEN pm.meta_key = '_lng' THEN pm.meta_value END) AS longitude
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id
WHERE p.post_type = 'campus' AND p.post_status = 'publish'
  AND pm.meta_key IN ('_lat','_lng')
GROUP BY p.ID, p.post_title ORDER BY p.ID;
