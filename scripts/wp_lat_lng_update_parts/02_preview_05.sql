-- PREVIEW 5
SELECT p.ID AS post_id, p.post_title,
  MAX(CASE WHEN pm.meta_key = '_lat' THEN pm.meta_value END) AS current_lat,
  MAX(CASE WHEN pm.meta_key = '_lng' THEN pm.meta_value END) AS current_lng,
  src.new_lat, src.new_lng
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key IN ('_lat','_lng')
INNER JOIN (
  SELECT 6250 AS post_id, '33.4697920' AS new_lat, '-81.9898260' AS new_lng
  UNION ALL SELECT 6251 AS post_id, '32.8125990' AS new_lat, '-83.6918520' AS new_lng
  UNION ALL SELECT 6252 AS post_id, '33.9292190' AS new_lat, '-84.5523410' AS new_lng
  UNION ALL SELECT 6253 AS post_id, '33.5943550' AS new_lat, '-84.3283980' AS new_lng
  UNION ALL SELECT 6254 AS post_id, '31.2554800' AS new_lat, '-81.4562600' AS new_lng
  UNION ALL SELECT 6255 AS post_id, '31.1838960' AS new_lat, '-81.4860300' AS new_lng
  UNION ALL SELECT 6256 AS post_id, '32.5064900' AS new_lat, '-84.9793700' AS new_lng
  UNION ALL SELECT 6257 AS post_id, '33.0805690' AS new_lat, '-83.2315900' AS new_lng
  UNION ALL SELECT 6258 AS post_id, '33.9793260' AS new_lat, '-84.0046370' AS new_lng
  UNION ALL SELECT 6259 AS post_id, '34.1698040' AS new_lat, '-85.2074550' AS new_lng
  UNION ALL SELECT 6260 AS post_id, '33.7689310' AS new_lat, '-84.4209000' AS new_lng
  UNION ALL SELECT 6261 AS post_id, '34.8100390' AS new_lat, '-85.2461780' AS new_lng
  UNION ALL SELECT 6262 AS post_id, '33.7898910' AS new_lat, '-84.2343440' AS new_lng
  UNION ALL SELECT 6263 AS post_id, '32.4261640' AS new_lat, '-81.7840630' AS new_lng
  UNION ALL SELECT 6264 AS post_id, '32.0563920' AS new_lat, '-84.2168710' AS new_lng
  UNION ALL SELECT 6265 AS post_id, '33.7535920' AS new_lat, '-84.3863400' AS new_lng
  UNION ALL SELECT 6266 AS post_id, '33.0475020' AS new_lat, '-84.1541410' AS new_lng
  UNION ALL SELECT 6267 AS post_id, '33.9625150' AS new_lat, '-84.0703120' AS new_lng
  UNION ALL SELECT 6268 AS post_id, '34.3309900' AS new_lat, '-83.7787600' AS new_lng
  UNION ALL SELECT 6269 AS post_id, '32.8080820' AS new_lat, '-83.7320770' AS new_lng
  UNION ALL SELECT 6270 AS post_id, '34.6397130' AS new_lat, '-83.5301380' AS new_lng
  UNION ALL SELECT 6271 AS post_id, '32.9966790' AS new_lat, '-82.8394600' AS new_lng
  UNION ALL SELECT 6272 AS post_id, '32.4340630' AS new_lat, '-81.7838150' AS new_lng
  UNION ALL SELECT 6273 AS post_id, '32.0234820' AS new_lat, '-81.1139890' AS new_lng
  UNION ALL SELECT 6274 AS post_id, '34.8395448' AS new_lat, '-83.7730000' AS new_lng
  UNION ALL SELECT 6275 AS post_id, '32.1179920' AS new_lat, '-84.1905840' AS new_lng
  UNION ALL SELECT 6276 AS post_id, '32.2038430' AS new_lat, '-82.3656820' AS new_lng
  UNION ALL SELECT 6277 AS post_id, '33.2552100' AS new_lat, '-84.2914530' AS new_lng
  UNION ALL SELECT 6278 AS post_id, '31.1988950' AS new_lat, '-83.7649270' AS new_lng
  UNION ALL SELECT 6279 AS post_id, '34.8394550' AS new_lat, '-83.7730000' AS new_lng
  UNION ALL SELECT 6280 AS post_id, '33.5743270' AS new_lat, '-85.0990090' AS new_lng
  UNION ALL SELECT 6281 AS post_id, '30.8451730' AS new_lat, '-83.2888150' AS new_lng
  UNION ALL SELECT 6282 AS post_id, '32.8745870' AS new_lat, '-83.7124670' AS new_lng
  UNION ALL SELECT 6283 AS post_id, '33.6909480' AS new_lat, '-85.1820500' AS new_lng
  UNION ALL SELECT 6284 AS post_id, '31.6595410' AS new_lat, '-83.2642920' AS new_lng
  UNION ALL SELECT 6285 AS post_id, '41.3920870' AS new_lat, '-82.4414340' AS new_lng
  UNION ALL SELECT 6286 AS post_id, '40.7964260' AS new_lat, '-81.4035610' AS new_lng
  UNION ALL SELECT 6287 AS post_id, '40.0768800' AS new_lat, '-80.9650730' AS new_lng
  UNION ALL SELECT 6288 AS post_id, '38.8933880' AS new_lat, '-82.3894000' AS new_lng
  UNION ALL SELECT 6289 AS post_id, '40.7877010' AS new_lat, '-81.4072000' AS new_lng
  UNION ALL SELECT 6290 AS post_id, '41.1006820' AS new_lat, '-80.6446580' AS new_lng
  UNION ALL SELECT 6291 AS post_id, '39.8964200' AS new_lat, '-83.8001220' AS new_lng
  UNION ALL SELECT 6292 AS post_id, '41.6937483' AS new_lat, '-83.4720947' AS new_lng
  UNION ALL SELECT 6293 AS post_id, '38.4918600' AS new_lat, '-82.4739900' AS new_lng
  UNION ALL SELECT 6294 AS post_id, '39.9611600' AS new_lat, '-82.9934400' AS new_lng
  UNION ALL SELECT 6295 AS post_id, '39.9687770' AS new_lat, '-82.9869620' AS new_lng
  UNION ALL SELECT 6296 AS post_id, '41.4948130' AS new_lat, '-81.6837320' AS new_lng
  UNION ALL SELECT 6297 AS post_id, '41.3443120' AS new_lat, '-81.6244420' AS new_lng
  UNION ALL SELECT 6298 AS post_id, '41.2959270' AS new_lat, '-84.3600780' AS new_lng
  UNION ALL SELECT 6299 AS post_id, '39.4439990' AS new_lat, '-82.2212480' AS new_lng
  UNION ALL SELECT 6300 AS post_id, '41.1472090' AS new_lat, '-81.3479670' AS new_lng
  UNION ALL SELECT 6301 AS post_id, '41.0319760' AS new_lat, '-80.7862580' AS new_lng
  UNION ALL SELECT 6302 AS post_id, '41.6938488' AS new_lat, '-83.4721384' AS new_lng
  UNION ALL SELECT 6303 AS post_id, '39.9372200' AS new_lat, '-81.9762300' AS new_lng
  UNION ALL SELECT 6304 AS post_id, '40.7992870' AS new_lat, '-82.5820520' AS new_lng
  UNION ALL SELECT 6305 AS post_id, '41.6937483' AS new_lat, '-83.4719533' AS new_lng
  UNION ALL SELECT 6306 AS post_id, '40.7384070' AS new_lat, '-84.0264020' AS new_lng
  UNION ALL SELECT 6307 AS post_id, '40.8701150' AS new_lat, '-81.4395570' AS new_lng
  UNION ALL SELECT 6308 AS post_id, '40.0056990' AS new_lat, '-83.0164340' AS new_lng
  UNION ALL SELECT 6309 AS post_id, '41.6938488' AS new_lat, '-83.4719096' AS new_lng
  UNION ALL SELECT 6310 AS post_id, '41.0769890' AS new_lat, '-81.5119950' AS new_lng
  UNION ALL SELECT 6311 AS post_id, '39.4304470' AS new_lat, '-81.4340760' AS new_lng
  UNION ALL SELECT 6312 AS post_id, '36.7227640' AS new_lat, '-81.9517660' AS new_lng
  UNION ALL SELECT 6313 AS post_id, '41.6939108' AS new_lat, '-83.4720240' AS new_lng
  UNION ALL SELECT 6314 AS post_id, '41.2343250' AS new_lat, '-77.0235400' AS new_lng
  UNION ALL SELECT 6315 AS post_id, '30.6157740' AS new_lat, '-96.3407950' AS new_lng
  UNION ALL SELECT 6316 AS post_id, '47.7110308' AS new_lat, '-122.3209250' AS new_lng
  UNION ALL SELECT 6317 AS post_id, '47.7110011' AS new_lat, '-122.3208258' AS new_lng
  UNION ALL SELECT 6318 AS post_id, '47.4901280' AS new_lat, '-117.5797810' AS new_lng
  UNION ALL SELECT 6319 AS post_id, '47.7108683' AS new_lat, '-122.3210035' AS new_lng
  UNION ALL SELECT 6320 AS post_id, '47.1455590' AS new_lat, '-122.4412970' AS new_lng
  UNION ALL SELECT 6321 AS post_id, '46.5715270' AS new_lat, '-120.5377170' AS new_lng
  UNION ALL SELECT 6322 AS post_id, '47.6032430' AS new_lat, '-122.3302860' AS new_lng
  UNION ALL SELECT 6323 AS post_id, '47.7485710' AS new_lat, '-122.3593390' AS new_lng
  UNION ALL SELECT 6324 AS post_id, '47.7109316' AS new_lat, '-122.3210578' AS new_lng
  UNION ALL SELECT 6325 AS post_id, '47.5483550' AS new_lat, '-122.3518370' AS new_lng
  UNION ALL SELECT 6326 AS post_id, '47.1179510' AS new_lat, '-122.5483950' AS new_lng
  UNION ALL SELECT 6327 AS post_id, '47.7533700' AS new_lat, '-117.4170250' AS new_lng
  UNION ALL SELECT 6328 AS post_id, '43.9108410' AS new_lat, '-90.0729570' AS new_lng
) src ON p.ID = src.post_id
WHERE p.post_type = 'campus' AND p.post_status = 'publish'
GROUP BY p.ID, p.post_title, src.new_lat, src.new_lng ORDER BY p.ID;
