-- PREVIEW 3
SELECT p.ID AS post_id, p.post_title,
  MAX(CASE WHEN pm.meta_key = '_lat' THEN pm.meta_value END) AS current_lat,
  MAX(CASE WHEN pm.meta_key = '_lng' THEN pm.meta_value END) AS current_lng,
  src.new_lat, src.new_lng
FROM wp_posts p
LEFT JOIN wp_postmeta pm ON p.ID = pm.post_id AND pm.meta_key IN ('_lat','_lng')
INNER JOIN (
  SELECT 6052 AS post_id, '37.8092679' AS new_lat, '-122.4164629' AS new_lng
  UNION ALL SELECT 6053 AS post_id, '37.8092966' AS new_lat, '-122.4166803' AS new_lng
  UNION ALL SELECT 6054 AS post_id, '32.8166828' AS new_lat, '-117.0073760' AS new_lng
  UNION ALL SELECT 6055 AS post_id, '37.8092432' AS new_lat, '-122.4166507' AS new_lng
  UNION ALL SELECT 6057 AS post_id, '37.8093938' AS new_lat, '-122.4165670' AS new_lng
  UNION ALL SELECT 6058 AS post_id, '33.6754120' AS new_lat, '-117.7777590' AS new_lng
  UNION ALL SELECT 6059 AS post_id, '38.9271300' AS new_lat, '-119.9720180' AS new_lng
  UNION ALL SELECT 6060 AS post_id, '37.7961520' AS new_lat, '-122.2613450' AS new_lng
  UNION ALL SELECT 6061 AS post_id, '37.7116850' AS new_lat, '-121.7998270' AS new_lng
  UNION ALL SELECT 6062 AS post_id, '40.4320300' AS new_lat, '-120.6317200' AS new_lng
  UNION ALL SELECT 6063 AS post_id, '37.8092679' AS new_lat, '-122.4166711' AS new_lng
  UNION ALL SELECT 6064 AS post_id, '34.0613118' AS new_lat, '-118.2328170' AS new_lng
  UNION ALL SELECT 6065 AS post_id, '33.7840060' AS new_lat, '-118.2836150' AS new_lng
  UNION ALL SELECT 6066 AS post_id, '37.3919700' AS new_lat, '-121.9807400' AS new_lng
  UNION ALL SELECT 6067 AS post_id, '34.0480510' AS new_lat, '-118.2541870' AS new_lng
  UNION ALL SELECT 6068 AS post_id, '34.0612220' AS new_lat, '-118.2328170' AS new_lng
  UNION ALL SELECT 6069 AS post_id, '34.0329160' AS new_lat, '-118.2697450' AS new_lng
  UNION ALL SELECT 6070 AS post_id, '34.0481408' AS new_lat, '-118.2541870' AS new_lng
  UNION ALL SELECT 6071 AS post_id, '38.0068160' AS new_lat, '-121.8601920' AS new_lng
  UNION ALL SELECT 6072 AS post_id, '36.9261150' AS new_lat, '-119.9972680' AS new_lng
  UNION ALL SELECT 6073 AS post_id, '39.1886860' AS new_lat, '-123.2276370' AS new_lng
  UNION ALL SELECT 6074 AS post_id, '37.3347990' AS new_lat, '-120.4754320' AS new_lng
  UNION ALL SELECT 6075 AS post_id, '37.7891620' AS new_lat, '-122.1666530' AS new_lng
  UNION ALL SELECT 6076 AS post_id, '33.1895170' AS new_lat, '-117.3010720' AS new_lng
  UNION ALL SELECT 6077 AS post_id, '37.8093261' AS new_lat, '-122.4164568' AS new_lng
  UNION ALL SELECT 6078 AS post_id, '37.6511830' AS new_lat, '-121.0097820' AS new_lng
  UNION ALL SELECT 6079 AS post_id, '36.5905800' AS new_lat, '-121.8849370' AS new_lng
  UNION ALL SELECT 6080 AS post_id, '34.2995000' AS new_lat, '-118.8331040' AS new_lng
  UNION ALL SELECT 6081 AS post_id, '37.8093890' AS new_lat, '-122.4166039' AS new_lng
  UNION ALL SELECT 6082 AS post_id, '34.0855930' AS new_lat, '-118.4827090' AS new_lng
  UNION ALL SELECT 6083 AS post_id, '34.0469810' AS new_lat, '-117.8489260' AS new_lng
  UNION ALL SELECT 6084 AS post_id, '33.8052580' AS new_lat, '-116.9721650' AS new_lng
  UNION ALL SELECT 6085 AS post_id, '38.2767590' AS new_lat, '-122.2750320' AS new_lng
  UNION ALL SELECT 6086 AS post_id, '33.9168500' AS new_lat, '-117.5688870' AS new_lng
  UNION ALL SELECT 6087 AS post_id, '37.5276860' AS new_lat, '-121.9163660' AS new_lng
  UNION ALL SELECT 6088 AS post_id, '37.8093261' AS new_lat, '-122.4166772' AS new_lng
  UNION ALL SELECT 6089 AS post_id, '34.1647150' AS new_lat, '-119.1573700' AS new_lng
  UNION ALL SELECT 6090 AS post_id, '33.6613790' AS new_lat, '-114.6525680' AS new_lng
  UNION ALL SELECT 6091 AS post_id, '33.1512260' AS new_lat, '-117.1827680' AS new_lng
  UNION ALL SELECT 6092 AS post_id, '34.1448590' AS new_lat, '-118.1182440' AS new_lng
  UNION ALL SELECT 6093 AS post_id, '34.0368518' AS new_lat, '-118.7055820' AS new_lng
  UNION ALL SELECT 6094 AS post_id, '37.8092432' AS new_lat, '-122.4164833' AS new_lng
  UNION ALL SELECT 6095 AS post_id, '36.6075930' AS new_lat, '-119.4597350' AS new_lng
  UNION ALL SELECT 6096 AS post_id, '37.8093531' AS new_lat, '-122.4166622' AS new_lng
  UNION ALL SELECT 6097 AS post_id, '37.8093040' AS new_lat, '-122.4165670' AS new_lng
  UNION ALL SELECT 6098 AS post_id, '38.5411050' AS new_lat, '-121.4903980' AS new_lng
  UNION ALL SELECT 6099 AS post_id, '33.5542140' AS new_lat, '-117.6640420' AS new_lng
  UNION ALL SELECT 6100 AS post_id, '37.8092250' AS new_lat, '-122.4165129' AS new_lng
  UNION ALL SELECT 6101 AS post_id, '32.7189070' AS new_lat, '-117.1516730' AS new_lng
  UNION ALL SELECT 6102 AS post_id, '32.8046950' AS new_lat, '-117.1679040' AS new_lng
  UNION ALL SELECT 6103 AS post_id, '32.9110140' AS new_lat, '-117.1213860' AS new_lng
  UNION ALL SELECT 6104 AS post_id, '32.7266470' AS new_lat, '-117.1678640' AS new_lng
  UNION ALL SELECT 6105 AS post_id, '37.7241950' AS new_lat, '-122.4822620' AS new_lng
  UNION ALL SELECT 6106 AS post_id, '37.9977860' AS new_lat, '-121.3206400' AS new_lng
  UNION ALL SELECT 6107 AS post_id, '37.3133330' AS new_lat, '-121.9305960' AS new_lng
  UNION ALL SELECT 6109 AS post_id, '37.3362468' AS new_lat, '-121.8906080' AS new_lng
  UNION ALL SELECT 6110 AS post_id, '33.7615860' AS new_lat, '-117.8918900' AS new_lng
  UNION ALL SELECT 6111 AS post_id, '34.4032670' AS new_lat, '-119.7015080' AS new_lng
  UNION ALL SELECT 6112 AS post_id, '34.0121870' AS new_lat, '-118.4930280' AS new_lng
  UNION ALL SELECT 6113 AS post_id, '38.4567920' AS new_lat, '-122.7200390' AS new_lng
  UNION ALL SELECT 6114 AS post_id, '33.7949650' AS new_lat, '-117.7671650' AS new_lng
  UNION ALL SELECT 6115 AS post_id, '40.6255010' AS new_lat, '-122.3180290' AS new_lng
  UNION ALL SELECT 6116 AS post_id, '38.7906640' AS new_lat, '-121.2139860' AS new_lng
  UNION ALL SELECT 6117 AS post_id, '37.8092250' AS new_lat, '-122.4166211' AS new_lng
  UNION ALL SELECT 6118 AS post_id, '38.2350640' AS new_lat, '-122.1224600' AS new_lng
  UNION ALL SELECT 6119 AS post_id, '37.8092154' AS new_lat, '-122.4165857' AS new_lng
  UNION ALL SELECT 6120 AS post_id, '35.1502330' AS new_lat, '-119.4603750' AS new_lng
  UNION ALL SELECT 6121 AS post_id, '37.8712700' AS new_lat, '-122.2620890' AS new_lng
  UNION ALL SELECT 6122 AS post_id, '38.5435590' AS new_lat, '-121.7389610' AS new_lng
  UNION ALL SELECT 6123 AS post_id, '33.6428620' AS new_lat, '-117.8412020' AS new_lng
  UNION ALL SELECT 6124 AS post_id, '34.0688690' AS new_lat, '-118.4422220' AS new_lng
  UNION ALL SELECT 6125 AS post_id, '37.8092966' AS new_lat, '-122.4164537' AS new_lng
  UNION ALL SELECT 6126 AS post_id, '33.9825130' AS new_lat, '-117.3742830' AS new_lng
  UNION ALL SELECT 6127 AS post_id, '37.8093749' AS new_lat, '-122.4164972' AS new_lng
  UNION ALL SELECT 6128 AS post_id, '37.7792380' AS new_lat, '-122.4193590' AS new_lng
  UNION ALL SELECT 6129 AS post_id, '34.4233490' AS new_lat, '-119.7034300' AS new_lng
  UNION ALL SELECT 6130 AS post_id, '36.9733100' AS new_lat, '-122.0271660' AS new_lng
  UNION ALL SELECT 6132 AS post_id, '32.7723940' AS new_lat, '-117.1901880' AS new_lng
  UNION ALL SELECT 6133 AS post_id, '37.9807230' AS new_lat, '-121.3108530' AS new_lng
  UNION ALL SELECT 6134 AS post_id, '37.8092154' AS new_lat, '-122.4165483' AS new_lng
  UNION ALL SELECT 6135 AS post_id, '34.2751410' AS new_lat, '-119.2373690' AS new_lng
  UNION ALL SELECT 6136 AS post_id, '34.4729400' AS new_lat, '-117.2669150' AS new_lng
  UNION ALL SELECT 6137 AS post_id, '36.1477410' AS new_lat, '-120.3570220' AS new_lng
  UNION ALL SELECT 6138 AS post_id, '36.2925300' AS new_lat, '-119.8232030' AS new_lng
  UNION ALL SELECT 6139 AS post_id, '34.0044340' AS new_lat, '-118.3876640' AS new_lng
  UNION ALL SELECT 6140 AS post_id, '37.2654850' AS new_lat, '-122.0110120' AS new_lng
  UNION ALL SELECT 6141 AS post_id, '38.6595800' AS new_lat, '-121.7361400' AS new_lng
  UNION ALL SELECT 6142 AS post_id, '37.8093749' AS new_lat, '-122.4166368' AS new_lng
) src ON p.ID = src.post_id
WHERE p.post_type = 'campus' AND p.post_status = 'publish'
GROUP BY p.ID, p.post_title, src.new_lat, src.new_lng ORDER BY p.ID;
