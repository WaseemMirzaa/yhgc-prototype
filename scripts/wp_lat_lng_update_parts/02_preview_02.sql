-- PREVIEW 2
SELECT p.ID AS post_id, p.post_title,
  MAX(CASE WHEN pm.meta_key = '_lat' THEN pm.meta_value END) AS current_lat,
  MAX(CASE WHEN pm.meta_key = '_lng' THEN pm.meta_value END) AS current_lng,
  src.new_lat, src.new_lng
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key IN ('_lat','_lng')
INNER JOIN (
  SELECT 4824 AS post_id, '43.5994980' AS new_lat, '-73.0011880' AS new_lng
  UNION ALL SELECT 4825 AS post_id, '42.0797630' AS new_lat, '-70.6792880' AS new_lng
  UNION ALL SELECT 4826 AS post_id, '42.3138490' AS new_lat, '-71.0397890' AS new_lng
  UNION ALL SELECT 4827 AS post_id, '40.4790920' AS new_lat, '-74.4249370' AS new_lng
  UNION ALL SELECT 4897 AS post_id, '26.3505100' AS new_lat, '-80.0864620' AS new_lng
  UNION ALL SELECT 4898 AS post_id, '25.7890690' AS new_lat, '-80.3307380' AS new_lng
  UNION ALL SELECT 5908 AS post_id, '34.0541990' AS new_lat, '-117.8192630' AS new_lng
  UNION ALL SELECT 5910 AS post_id, '34.1651260' AS new_lat, '-119.0449100' AS new_lng
  UNION ALL SELECT 5920 AS post_id, '34.9441450' AS new_lat, '-120.4201950' AS new_lng
  UNION ALL SELECT 5921 AS post_id, '38.6493300' AS new_lat, '-121.3481500' AS new_lng
  UNION ALL SELECT 5923 AS post_id, '34.6756430' AS new_lat, '-118.1868250' AS new_lng
  UNION ALL SELECT 5925 AS post_id, '35.4082920' AS new_lat, '-118.9716560' AS new_lng
  UNION ALL SELECT 5926 AS post_id, '47.6094780' AS new_lat, '-122.3319820' AS new_lng
  UNION ALL SELECT 5927 AS post_id, '34.8714700' AS new_lat, '-117.0255400' AS new_lng
  UNION ALL SELECT 5929 AS post_id, '37.8698230' AS new_lat, '-122.2695880' AS new_lng
  UNION ALL SELECT 5930 AS post_id, '31.9663202' AS new_lat, '-94.0529300' AS new_lng
  UNION ALL SELECT 5931 AS post_id, '39.6497350' AS new_lat, '-121.6455010' AS new_lng
  UNION ALL SELECT 5932 AS post_id, '36.9877100' AS new_lat, '-121.9282400' AS new_lng
  UNION ALL SELECT 5934 AS post_id, '34.0542888' AS new_lat, '-117.8192630' AS new_lng
  UNION ALL SELECT 5935 AS post_id, '35.3009310' AS new_lat, '-120.6585400' AS new_lng
  UNION ALL SELECT 5938 AS post_id, '35.3496408' AS new_lat, '-119.1068220' AS new_lng
  UNION ALL SELECT 5941 AS post_id, '34.1652158' AS new_lat, '-119.0449100' AS new_lng
  UNION ALL SELECT 5943 AS post_id, '33.8665058' AS new_lat, '-118.2571720' AS new_lng
  UNION ALL SELECT 5945 AS post_id, '37.6560560' AS new_lat, '-122.0562020' AS new_lng
  UNION ALL SELECT 5947 AS post_id, '36.8135640' AS new_lat, '-119.7461490' AS new_lng
  UNION ALL SELECT 5948 AS post_id, '33.8823348' AS new_lat, '-117.8894040' AS new_lng
  UNION ALL SELECT 5949 AS post_id, '33.7764100' AS new_lat, '-118.1126510' AS new_lng
  UNION ALL SELECT 5951 AS post_id, '34.0619540' AS new_lat, '-118.1736570' AS new_lng
  UNION ALL SELECT 5952 AS post_id, '36.6516700' AS new_lat, '-121.8017200' AS new_lng
  UNION ALL SELECT 5953 AS post_id, '34.2361558' AS new_lat, '-118.5280670' AS new_lng
  UNION ALL SELECT 5954 AS post_id, '38.5634260' AS new_lat, '-121.4237770' AS new_lng
  UNION ALL SELECT 5955 AS post_id, '34.1812300' AS new_lat, '-117.3236520' AS new_lng
  UNION ALL SELECT 5956 AS post_id, '33.1279788' AS new_lat, '-117.1595050' AS new_lng
  UNION ALL SELECT 5957 AS post_id, '41.8532110' AS new_lat, '-75.7938480' AS new_lng
  UNION ALL SELECT 5960 AS post_id, '45.9038900' AS new_lat, '-119.5341150' AS new_lng
  UNION ALL SELECT 5963 AS post_id, '41.6938210' AS new_lat, '-83.4720240' AS new_lng
  UNION ALL SELECT 5965 AS post_id, '40.4810030' AS new_lat, '-74.4557590' AS new_lng
  UNION ALL SELECT 5971 AS post_id, '42.1792550' AS new_lat, '-84.7716040' AS new_lng
  UNION ALL SELECT 5976 AS post_id, '45.3363050' AS new_lat, '-84.0754200' AS new_lng
  UNION ALL SELECT 5978 AS post_id, '42.1791652' AS new_lat, '-84.7716040' AS new_lng
  UNION ALL SELECT 5981 AS post_id, '41.8491110' AS new_lat, '-71.4064920' AS new_lng
  UNION ALL SELECT 5984 AS post_id, '39.9518118' AS new_lat, '-86.0087310' AS new_lng
  UNION ALL SELECT 5991 AS post_id, '36.9794990' AS new_lat, '-122.0533950' AS new_lng
  UNION ALL SELECT 5994 AS post_id, '33.9754320' AS new_lat, '-117.3317010' AS new_lng
  UNION ALL SELECT 5998 AS post_id, '37.7211830' AS new_lat, '-122.4765930' AS new_lng
  UNION ALL SELECT 5999 AS post_id, '32.7721380' AS new_lat, '-117.0726610' AS new_lng
  UNION ALL SELECT 6002 AS post_id, '34.0367620' AS new_lat, '-118.7055820' AS new_lng
  UNION ALL SELECT 6008 AS post_id, '38.3409630' AS new_lat, '-122.6755170' AS new_lng
  UNION ALL SELECT 6009 AS post_id, '37.5250520' AS new_lat, '-120.8560350' AS new_lng
  UNION ALL SELECT 6011 AS post_id, '36.6517598' AS new_lat, '-121.8017200' AS new_lng
  UNION ALL SELECT 6012 AS post_id, '37.4493020' AS new_lat, '-122.2616150' AS new_lng
  UNION ALL SELECT 6013 AS post_id, '33.8864550' AS new_lat, '-118.0945470' AS new_lng
  UNION ALL SELECT 6014 AS post_id, '35.5674400' AS new_lat, '-117.6681330' AS new_lng
  UNION ALL SELECT 6015 AS post_id, '37.6417890' AS new_lat, '-122.1056010' AS new_lng
  UNION ALL SELECT 6016 AS post_id, '34.1487610' AS new_lat, '-117.5733500' AS new_lng
  UNION ALL SELECT 6019 AS post_id, '39.7301120' AS new_lat, '-121.8433440' AS new_lng
  UNION ALL SELECT 6020 AS post_id, '34.1346710' AS new_lat, '-117.8852390' AS new_lng
  UNION ALL SELECT 6021 AS post_id, '37.7249430' AS new_lat, '-122.4529310' AS new_lng
  UNION ALL SELECT 6022 AS post_id, '34.4023410' AS new_lat, '-103.1660020' AS new_lng
  UNION ALL SELECT 6023 AS post_id, '33.7158080' AS new_lat, '-117.9292100' AS new_lng
  UNION ALL SELECT 6024 AS post_id, '37.7807620' AS new_lat, '-122.2793140' AS new_lng
  UNION ALL SELECT 6025 AS post_id, '37.9555970' AS new_lat, '-122.5496010' AS new_lng
  UNION ALL SELECT 6026 AS post_id, '37.5341860' AS new_lat, '-122.3351790' AS new_lng
  UNION ALL SELECT 6027 AS post_id, '34.4031100' AS new_lat, '-118.5694600' AS new_lng
  UNION ALL SELECT 6028 AS post_id, '33.7333990' AS new_lat, '-116.3896830' AS new_lng
  UNION ALL SELECT 6029 AS post_id, '40.6982870' AS new_lat, '-124.1966300' AS new_lng
  UNION ALL SELECT 6030 AS post_id, '36.3243490' AS new_lat, '-119.3163170' AS new_lng
  UNION ALL SELECT 6031 AS post_id, '41.4129950' AS new_lat, '-122.3889890' AS new_lng
  UNION ALL SELECT 6032 AS post_id, '38.9574480' AS new_lat, '-92.3264690' AS new_lng
  UNION ALL SELECT 6033 AS post_id, '33.8775050' AS new_lat, '-118.2111060' AS new_lng
  UNION ALL SELECT 6034 AS post_id, '37.9660600' AS new_lat, '-122.3393320' AS new_lng
  UNION ALL SELECT 6035 AS post_id, '34.1399780' AS new_lat, '-116.2133930' AS new_lng
  UNION ALL SELECT 6036 AS post_id, '38.4537320' AS new_lat, '-121.4225140' AS new_lng
  UNION ALL SELECT 6037 AS post_id, '34.0391250' AS new_lat, '-117.1012590' AS new_lng
  UNION ALL SELECT 6038 AS post_id, '32.8165930' AS new_lat, '-117.0073760' AS new_lng
  UNION ALL SELECT 6039 AS post_id, '32.7433670' AS new_lat, '-116.9423280' AS new_lng
  UNION ALL SELECT 6040 AS post_id, '33.8309960' AS new_lat, '-118.0261300' AS new_lng
  UNION ALL SELECT 6041 AS post_id, '37.8093531' AS new_lat, '-122.4164718' AS new_lng
  UNION ALL SELECT 6042 AS post_id, '37.9685630' AS new_lat, '-122.0712700' AS new_lng
  UNION ALL SELECT 6043 AS post_id, '34.0409390' AS new_lat, '-118.1501640' AS new_lng
  UNION ALL SELECT 6044 AS post_id, '37.8093890' AS new_lat, '-122.4165301' AS new_lng
  UNION ALL SELECT 6045 AS post_id, '37.3005410' AS new_lat, '-121.7618210' AS new_lng
  UNION ALL SELECT 6046 AS post_id, '39.9502330' AS new_lat, '-120.9692850' AS new_lng
  UNION ALL SELECT 6047 AS post_id, '38.6624500' AS new_lat, '-121.1281800' AS new_lng
  UNION ALL SELECT 6048 AS post_id, '37.3608990' AS new_lat, '-122.1302250' AS new_lng
  UNION ALL SELECT 6049 AS post_id, '36.7660880' AS new_lat, '-119.7974100' AS new_lng
  UNION ALL SELECT 6050 AS post_id, '33.8758130' AS new_lat, '-117.9196110' AS new_lng
  UNION ALL SELECT 6051 AS post_id, '36.9738090' AS new_lat, '-121.5691550' AS new_lng
) src ON p.ID = src.post_id
WHERE p.post_type = 'campus' AND p.post_status = 'publish'
GROUP BY p.ID, p.post_title, src.new_lat, src.new_lng ORDER BY p.ID;
