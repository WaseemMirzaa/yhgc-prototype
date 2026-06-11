-- PREVIEW 4
SELECT p.ID AS post_id, p.post_title,
  MAX(CASE WHEN pm.meta_key = '_lat' THEN pm.meta_value END) AS current_lat,
  MAX(CASE WHEN pm.meta_key = '_lng' THEN pm.meta_value END) AS current_lng,
  src.new_lat, src.new_lng
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key IN ('_lat','_lng')
INNER JOIN (
  SELECT 6143 AS post_id, '38.0131880' AS new_lat, '-107.6830620' AS new_lng
  UNION ALL SELECT 6144 AS post_id, '30.4241750' AS new_lat, '-84.2859300' AS new_lng
  UNION ALL SELECT 6146 AS post_id, '26.3694300' AS new_lat, '-80.1022900' AS new_lng
  UNION ALL SELECT 6148 AS post_id, '28.7440920' AS new_lat, '-81.3056940' AS new_lng
  UNION ALL SELECT 6149 AS post_id, '27.7784040' AS new_lat, '-82.7328920' AS new_lng
  UNION ALL SELECT 6150 AS post_id, '29.5914740' AS new_lat, '-82.4098960' AS new_lng
  UNION ALL SELECT 6151 AS post_id, '30.2718180' AS new_lat, '-81.5093040' AS new_lng
  UNION ALL SELECT 6152 AS post_id, '28.0587010' AS new_lat, '-82.4155080' AS new_lng
  UNION ALL SELECT 6153 AS post_id, '31.5692790' AS new_lat, '-84.1418370' AS new_lng
  UNION ALL SELECT 6154 AS post_id, '32.5041570' AS new_lat, '-84.9403340' AS new_lng
  UNION ALL SELECT 6155 AS post_id, '34.7754390' AS new_lat, '-85.0038230' AS new_lng
  UNION ALL SELECT 6156 AS post_id, '32.5949680' AS new_lat, '-82.3091980' AS new_lng
  UNION ALL SELECT 6157 AS post_id, '32.5350400' AS new_lat, '-83.9001410' AS new_lng
  UNION ALL SELECT 6159 AS post_id, '32.0246570' AS new_lat, '-81.0557080' AS new_lng
  UNION ALL SELECT 6160 AS post_id, '33.9567830' AS new_lat, '-83.3741480' AS new_lng
  UNION ALL SELECT 6161 AS post_id, '37.7204650' AS new_lat, '-97.2918310' AS new_lng
  UNION ALL SELECT 6163 AS post_id, '42.1792550' AS new_lat, '-84.7717252' AS new_lng
  UNION ALL SELECT 6166 AS post_id, '43.5131468' AS new_lat, '-83.9644660' AS new_lng
  UNION ALL SELECT 6170 AS post_id, '44.9657810' AS new_lat, '-93.2406630' AS new_lng
  UNION ALL SELECT 6171 AS post_id, '41.2578630' AS new_lat, '-96.0107650' AS new_lng
  UNION ALL SELECT 6172 AS post_id, '39.5721640' AS new_lat, '-119.7942590' AS new_lng
  UNION ALL SELECT 6173 AS post_id, '36.1074480' AS new_lat, '-115.1422730' AS new_lng
  UNION ALL SELECT 6175 AS post_id, '39.5394670' AS new_lat, '-119.8128040' AS new_lng
  UNION ALL SELECT 6176 AS post_id, '35.9211430' AS new_lat, '-94.9659040' AS new_lng
  UNION ALL SELECT 6177 AS post_id, '35.3873700' AS new_lat, '-97.5702700' AS new_lng
  UNION ALL SELECT 6178 AS post_id, '40.6212860' AS new_lat, '-80.0306610' AS new_lng
  UNION ALL SELECT 6179 AS post_id, '40.9969980' AS new_lat, '-75.1736300' AS new_lng
  UNION ALL SELECT 6182 AS post_id, '40.1173420' AS new_lat, '-75.1203020' AS new_lng
  UNION ALL SELECT 6183 AS post_id, '40.7967928' AS new_lat, '-77.8628560' AS new_lng
  UNION ALL SELECT 6184 AS post_id, '40.0668050' AS new_lat, '-79.8856830' AS new_lng
  UNION ALL SELECT 6185 AS post_id, '41.8531212' AS new_lat, '-75.7938480' AS new_lng
  UNION ALL SELECT 6186 AS post_id, '40.4248840' AS new_lat, '-80.1893260' AS new_lng
  UNION ALL SELECT 6187 AS post_id, '40.7966132' AS new_lat, '-77.8628560' AS new_lng
  UNION ALL SELECT 6188 AS post_id, '39.9518910' AS new_lat, '-75.5980450' AS new_lng
  UNION ALL SELECT 6189 AS post_id, '40.2342880' AS new_lat, '-79.5651230' AS new_lng
  UNION ALL SELECT 6190 AS post_id, '30.0867050' AS new_lat, '-95.9893990' AS new_lng
  UNION ALL SELECT 6192 AS post_id, '31.9664998' AS new_lat, '-94.0529300' AS new_lng
  UNION ALL SELECT 6193 AS post_id, '31.0528150' AS new_lat, '-97.7738800' AS new_lng
  UNION ALL SELECT 6194 AS post_id, '34.9926960' AS new_lat, '-101.9101700' AS new_lng
  UNION ALL SELECT 6195 AS post_id, '29.4245340' AS new_lat, '-98.4914840' AS new_lng
  UNION ALL SELECT 6197 AS post_id, '33.2259598' AS new_lat, '-97.1288200' AS new_lng
  UNION ALL SELECT 6199 AS post_id, '30.2861110' AS new_lat, '-97.7392900' AS new_lng
  UNION ALL SELECT 6200 AS post_id, '30.2681618' AS new_lat, '-97.7428060' AS new_lng
  UNION ALL SELECT 6201 AS post_id, '37.4932510' AS new_lat, '-77.5656420' AS new_lng
  UNION ALL SELECT 6202 AS post_id, '47.7109410' AS new_lat, '-122.3209250' AS new_lng
  UNION ALL SELECT 6203 AS post_id, '48.7656930' AS new_lat, '-122.5128590' AS new_lng
  UNION ALL SELECT 6204 AS post_id, '47.2522900' AS new_lat, '-122.4465800' AS new_lng
  UNION ALL SELECT 6205 AS post_id, '45.8169960' AS new_lat, '-122.6770880' AS new_lng
  UNION ALL SELECT 6206 AS post_id, '48.4371220' AS new_lat, '-122.3088880' AS new_lng
  UNION ALL SELECT 6207 AS post_id, '47.7109688' AS new_lat, '-122.3207980' AS new_lng
  UNION ALL SELECT 6208 AS post_id, '48.0065890' AS new_lat, '-122.2047750' AS new_lng
  UNION ALL SELECT 6209 AS post_id, '48.0066788' AS new_lat, '-122.2047750' AS new_lng
  UNION ALL SELECT 6210 AS post_id, '47.7110011' AS new_lat, '-122.3210242' AS new_lng
  UNION ALL SELECT 6212 AS post_id, '47.7110231' AS new_lat, '-122.3209793' AS new_lng
  UNION ALL SELECT 6213 AS post_id, '47.3881200' AS new_lat, '-122.3004500' AS new_lng
  UNION ALL SELECT 6214 AS post_id, '47.7109316' AS new_lat, '-122.3207922' AS new_lng
  UNION ALL SELECT 6215 AS post_id, '46.1375330' AS new_lat, '-122.9370210' AS new_lng
  UNION ALL SELECT 6216 AS post_id, '47.5753070' AS new_lat, '-122.6352390' AS new_lng
  UNION ALL SELECT 6217 AS post_id, '47.7108961' AS new_lat, '-122.3210406' AS new_lng
  UNION ALL SELECT 6218 AS post_id, '47.7110231' AS new_lat, '-122.3208707' AS new_lng
  UNION ALL SELECT 6219 AS post_id, '47.7108961' AS new_lat, '-122.3208094' AS new_lng
  UNION ALL SELECT 6220 AS post_id, '47.7108683' AS new_lat, '-122.3208465' AS new_lng
  UNION ALL SELECT 6221 AS post_id, '47.6095678' AS new_lat, '-122.3319820' AS new_lng
  UNION ALL SELECT 6222 AS post_id, '47.7486608' AS new_lat, '-122.3593390' AS new_lng
  UNION ALL SELECT 6223 AS post_id, '47.0231440' AS new_lat, '-122.9302520' AS new_lng
  UNION ALL SELECT 6224 AS post_id, '47.6750300' AS new_lat, '-117.3617700' AS new_lng
  UNION ALL SELECT 6225 AS post_id, '47.6755620' AS new_lat, '-117.4605060' AS new_lng
  UNION ALL SELECT 6227 AS post_id, '47.2470910' AS new_lat, '-122.5234610' AS new_lng
  UNION ALL SELECT 6228 AS post_id, '47.6565800' AS new_lat, '-122.3127000' AS new_lng
  UNION ALL SELECT 6229 AS post_id, '47.7108531' AS new_lat, '-122.3208972' AS new_lng
  UNION ALL SELECT 6230 AS post_id, '47.7109688' AS new_lat, '-122.3210520' AS new_lng
  UNION ALL SELECT 6231 AS post_id, '46.7297210' AS new_lat, '-117.1818510' AS new_lng
  UNION ALL SELECT 6232 AS post_id, '47.7108531' AS new_lat, '-122.3209528' AS new_lng
  UNION ALL SELECT 6233 AS post_id, '48.7379280' AS new_lat, '-122.4841690' AS new_lng
  UNION ALL SELECT 6234 AS post_id, '48.7943860' AS new_lat, '-122.4938530' AS new_lng
  UNION ALL SELECT 6235 AS post_id, '46.5985050' AS new_lat, '-120.5222550' AS new_lng
  UNION ALL SELECT 6236 AS post_id, '43.9107512' AS new_lat, '-90.0729570' AS new_lng
  UNION ALL SELECT 6237 AS post_id, '44.5243160' AS new_lat, '-89.5688850' AS new_lng
  UNION ALL SELECT 6238 AS post_id, '44.8585170' AS new_lat, '-92.6259680' AS new_lng
  UNION ALL SELECT 6240 AS post_id, '43.8135520' AS new_lat, '-91.2298970' AS new_lng
  UNION ALL SELECT 6242 AS post_id, '43.9109308' AS new_lat, '-90.0729570' AS new_lng
  UNION ALL SELECT 6243 AS post_id, '42.8361330' AS new_lat, '-88.7434610' AS new_lng
  UNION ALL SELECT 6244 AS post_id, '31.4812920' AS new_lat, '-83.5261610' AS new_lng
  UNION ALL SELECT 6245 AS post_id, '31.5545100' AS new_lat, '-84.1743180' AS new_lng
  UNION ALL SELECT 6246 AS post_id, '33.9913600' AS new_lat, '-83.3389500' AS new_lng
  UNION ALL SELECT 6247 AS post_id, '33.7089240' AS new_lat, '-84.4047320' AS new_lng
  UNION ALL SELECT 6248 AS post_id, '33.7126500' AS new_lat, '-84.4062900' AS new_lng
  UNION ALL SELECT 6249 AS post_id, '33.4184430' AS new_lat, '-82.0454310' AS new_lng
) src ON p.ID = src.post_id
WHERE p.post_type = 'campus' AND p.post_status = 'publish'
GROUP BY p.ID, p.post_title, src.new_lat, src.new_lng ORDER BY p.ID;
