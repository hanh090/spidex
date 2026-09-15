#!/usr/bin/env python3
"""
Comprehensive Vietnam Birds & Butterflies Master Checklist Compiler for Spidex.
Merges official ornithological & entomological taxonomic checklists:
- Aves (Birds): ~950 species across 100+ families (IOC / Craik & Minh / Vietnam Red Book).
- Lepidoptera (Butterflies): ~1,200+ species across 6 families (Monastyrskii & Devyatkin / iNat / GBIF).
Generates standardized master JSON files and rich markdown field checklists.
"""
import os
import re
import json
from collections import Counter

CACHE_DIR = "data/cache_wiki"
OUT_DIR = "data/checklists"
DOCS_DIR = "docs"
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(DOCS_DIR, exist_ok=True)

# -----------------------------------------------------------------------------
# 1. TAXONOMIC DICTIONARIES
# -----------------------------------------------------------------------------

BIRD_FAMILY_MAP = {
    "Anatidae": {"en": "Ducks, Geese, Waterfowl", "vi": "Họ Vịt", "order": "Anseriformes"},
    "Phasianidae": {"en": "Pheasants, Partridges, Quail", "vi": "Họ Trĩ", "order": "Galliformes"},
    "Podicipedidae": {"en": "Grebes", "vi": "Họ Chim lặn", "order": "Podicipediformes"},
    "Columbidae": {"en": "Pigeons and Doves", "vi": "Họ Bồ câu", "order": "Columbiformes"},
    "Otididae": {"en": "Bustards", "vi": "Họ Ô tác", "order": "Otidiformes"},
    "Cuculidae": {"en": "Cuckoos and Coucals", "vi": "Họ Cu cu", "order": "Cuculiformes"},
    "Podargidae": {"en": "Frogmouths", "vi": "Họ Cú muỗi mỏ quặp", "order": "Caprimulgiformes"},
    "Caprimulgidae": {"en": "Nightjars", "vi": "Họ Cú muỗi", "order": "Caprimulgiformes"},
    "Apodidae": {"en": "Swifts", "vi": "Họ Yến", "order": "Apodiformes"},
    "Hemiprocnidae": {"en": "Treeswifts", "vi": "Họ Yến mào", "order": "Apodiformes"},
    "Rallidae": {"en": "Rails, Gallinules, Coots", "vi": "Họ Gà nước", "order": "Gruiformes"},
    "Heliornithidae": {"en": "Finfoots", "vi": "Họ Chân bơi", "order": "Gruiformes"},
    "Gruidae": {"en": "Cranes", "vi": "Họ Sếu", "order": "Gruiformes"},
    "Burhinidae": {"en": "Thick-knees", "vi": "Họ Dẽ cùi", "order": "Charadriiformes"},
    "Recurvirostridae": {"en": "Stilts and Avocets", "vi": "Họ Cà kheo", "order": "Charadriiformes"},
    "Haematopodidae": {"en": "Oystercatchers", "vi": "Họ Mò sò", "order": "Charadriiformes"},
    "Charadriidae": {"en": "Plovers and Lapwings", "vi": "Họ Choi choi", "order": "Charadriiformes"},
    "Rostratulidae": {"en": "Painted-snipes", "vi": "Họ Nhát hoa", "order": "Charadriiformes"},
    "Jacanidae": {"en": "Jacanas", "vi": "Họ Gà lôi nước", "order": "Charadriiformes"},
    "Scolopacidae": {"en": "Sandpipers and Allies", "vi": "Họ Dẽ / Choắt", "order": "Charadriiformes"},
    "Turnicidae": {"en": "Buttonquails", "vi": "Họ Cút ba ngón", "order": "Charadriiformes"},
    "Glareolidae": {"en": "Pratincoles and Coursers", "vi": "Họ Chim vằn", "order": "Charadriiformes"},
    "Laridae": {"en": "Gulls, Terns, Skimmers", "vi": "Họ Mòng biển / Nhạn biển", "order": "Charadriiformes"},
    "Stercorariidae": {"en": "Skuas and Jaegers", "vi": "Họ Cướp biển", "order": "Charadriiformes"},
    "Phaethontidae": {"en": "Tropicbirds", "vi": "Họ Chim nhiệt đới", "order": "Phaethontiformes"},
    "Hydrobatidae": {"en": "Storm-petrels", "vi": "Họ Hải yến", "order": "Procellariiformes"},
    "Procellariidae": {"en": "Petrels and Shearwaters", "vi": "Họ Hải âu", "order": "Procellariiformes"},
    "Ciconiidae": {"en": "Storks", "vi": "Họ Hạc", "order": "Ciconiiformes"},
    "Fregatidae": {"en": "Frigatebirds", "vi": "Họ Cốc biển", "order": "Suliformes"},
    "Sulidae": {"en": "Boobies and Gannets", "vi": "Họ Chim điên", "order": "Suliformes"},
    "Anhingidae": {"en": "Anhingas", "vi": "Họ Chim cổ rắn", "order": "Suliformes"},
    "Phalacrocoracidae": {"en": "Cormorants and Shags", "vi": "Họ Cốc", "order": "Suliformes"},
    "Pelecanidae": {"en": "Pelicans", "vi": "Họ Bồ nông", "order": "Pelecaniformes"},
    "Ardeidae": {"en": "Herons, Egrets, Bitterns", "vi": "Họ Diệc / Cò bợ", "order": "Pelecaniformes"},
    "Threskiornithidae": {"en": "Ibises and Spoonbills", "vi": "Họ Cò quăm / Cò thìa", "order": "Pelecaniformes"},
    "Pandionidae": {"en": "Osprey", "vi": "Họ Ưng biển / Ó cá", "order": "Accipitriformes"},
    "Accipitridae": {"en": "Hawks, Eagles, Kites", "vi": "Họ Ưng / Diều hâu / Đại bàng", "order": "Accipitriformes"},
    "Tytonidae": {"en": "Barn-owls", "vi": "Họ Cú lợn", "order": "Strigiformes"},
    "Strigidae": {"en": "True Owls", "vi": "Họ Cú mèo", "order": "Strigiformes"},
    "Trogonidae": {"en": "Trogons", "vi": "Họ Nuốc", "order": "Trogoniformes"},
    "Upupidae": {"en": "Hoopoes", "vi": "Họ Đầu rìu", "order": "Bucerotiformes"},
    "Bucerotidae": {"en": "Hornbills", "vi": "Họ Hồng hoàng / Niệc", "order": "Bucerotiformes"},
    "Alcedinidae": {"en": "Kingfishers", "vi": "Họ Bồng chanh / Bói cá", "order": "Coraciiformes"},
    "Meropidae": {"en": "Bee-eaters", "vi": "Họ Trảu", "order": "Coraciiformes"},
    "Coraciidae": {"en": "Rollers", "vi": "Họ Sả rừng", "order": "Coraciiformes"},
    "Eurystomidae": {"en": "Dollarbirds", "vi": "Họ Yểng quạ", "order": "Coraciiformes"},
    "Megalaimidae": {"en": "Asian Barbets", "vi": "Họ Cu rốc", "order": "Piciformes"},
    "Indicatoridae": {"en": "Honeyguides", "vi": "Họ Chỉ dẫn hạt", "order": "Piciformes"},
    "Picidae": {"en": "Woodpeckers", "vi": "Họ Gõ kiến", "order": "Piciformes"},
    "Falconidae": {"en": "Falcons and Caracaras", "vi": "Họ Cắt", "order": "Falconiformes"},
    "Psittaculidae": {"en": "Old World Parrots", "vi": "Họ Vẹt", "order": "Psittaciformes"},
    "Eurylaimidae": {"en": "Broadbills", "vi": "Họ Mỏ rộng", "order": "Passeriformes"},
    "Calyptomenidae": {"en": "African and Green Broadbills", "vi": "Họ Mỏ rộng xanh", "order": "Passeriformes"},
    "Pittidae": {"en": "Pittas", "vi": "Họ Đuôi cụt", "order": "Passeriformes"},
    "Campephagidae": {"en": "Cuckooshrikes", "vi": "Họ Phường chèo", "order": "Passeriformes"},
    "Vireonidae": {"en": "Vireos, Shrike-babblers", "vi": "Họ Khướu bách thanh", "order": "Passeriformes"},
    "Pachycephalidae": {"en": "Whistlers", "vi": "Họ Đuôi cộc hót", "order": "Passeriformes"},
    "Oriolidae": {"en": "Old World Orioles", "vi": "Họ Hoàng anh", "order": "Passeriformes"},
    "Artamidae": {"en": "Woodswallows", "vi": "Họ Nhạn rừng", "order": "Passeriformes"},
    "Vangidae": {"en": "Vangas, Helmetshrikes, Woodshrikes", "vi": "Họ Phường chèo đất", "order": "Passeriformes"},
    "Aegithinidae": {"en": "Ioras", "vi": "Họ Chim nghệ", "order": "Passeriformes"},
    "Rhipiduridae": {"en": "Fantails", "vi": "Họ Rẻ quạt", "order": "Passeriformes"},
    "Dicruridae": {"en": "Drongos", "vi": "Họ Chèo bẻo", "order": "Passeriformes"},
    "Monarchidae": {"en": "Monarch Flycatchers", "vi": "Họ Đớp ruồi đuôi xòe", "order": "Passeriformes"},
    "Laniidae": {"en": "Shrikes", "vi": "Họ Bách thanh", "order": "Passeriformes"},
    "Corvidae": {"en": "Crows, Jays, Magpies", "vi": "Họ Quạ / Giẻ cùi", "order": "Passeriformes"},
    "Paridae": {"en": "Tits, Chickadees", "vi": "Họ Bạc má", "order": "Passeriformes"},
    "Stenostiridae": {"en": "Fairy Flycatchers", "vi": "Họ Đớp ruồi tiên", "order": "Passeriformes"},
    "Alaudidae": {"en": "Larks", "vi": "Họ Sơn ca", "order": "Passeriformes"},
    "Cisticolidae": {"en": "Cisticolas and Allies", "vi": "Họ Chiền chiện", "order": "Passeriformes"},
    "Acrocephalidae": {"en": "Reed Warblers and Allies", "vi": "Họ Chích đầm lầy", "order": "Passeriformes"},
    "Locustellidae": {"en": "Grassbirds and Allies", "vi": "Họ Chích bụi", "order": "Passeriformes"},
    "Pnoepygidae": {"en": "Cupwings", "vi": "Họ Khướu đất cụt đuôi", "order": "Passeriformes"},
    "Hirundinidae": {"en": "Swallows, Martins", "vi": "Họ Nhạn", "order": "Passeriformes"},
    "Pycnonotidae": {"en": "Bulbuls", "vi": "Họ Chào mào / Cành cạch", "order": "Passeriformes"},
    "Phylloscopidae": {"en": "Leaf Warblers", "vi": "Họ Chích lá", "order": "Passeriformes"},
    "Scotocercidae": {"en": "Bush Warblers", "vi": "Họ Chích ngực xám", "order": "Passeriformes"},
    "Aegithalidae": {"en": "Long-tailed Tits", "vi": "Họ Bạc má đuôi dài", "order": "Passeriformes"},
    "Sylviidae": {"en": "Sylviid Babblers, Parrotbills", "vi": "Họ Khướu mỏ dẹt", "order": "Passeriformes"},
    "Zosteropidae": {"en": "White-eyes", "vi": "Họ Vành khuyên", "order": "Passeriformes"},
    "Timaliidae": {"en": "Babblers, Scimitar-babblers", "vi": "Họ Họa mi / Khướu mỏ cong", "order": "Passeriformes"},
    "Pellorneidae": {"en": "Ground Babblers", "vi": "Họ Khướu đất", "order": "Passeriformes"},
    "Leiothrichidae": {"en": "Laughingthrushes and Allies", "vi": "Họ Khướu cười / Kim oanh", "order": "Passeriformes"},
    "Irenidae": {"en": "Fairy-bluebirds", "vi": "Họ Chim xanh", "order": "Passeriformes"},
    "Chloropseidae": {"en": "Leafbirds", "vi": "Họ Chim bắp chuối", "order": "Passeriformes"},
    "Dicaeidae": {"en": "Flowerpeckers", "vi": "Họ Chim sâu", "order": "Passeriformes"},
    "Nectariniidae": {"en": "Sunbirds and Spiderhunters", "vi": "Họ Hút mật", "order": "Passeriformes"},
    "Sittidae": {"en": "Nuthatches", "vi": "Họ Trèo cây", "order": "Passeriformes"},
    "Certhiidae": {"en": "Treecreepers", "vi": "Họ Đuôi gai", "order": "Passeriformes"},
    "Sturnidae": {"en": "Starlings, Mynas", "vi": "Họ Sáo / Yểng", "order": "Passeriformes"},
    "Turdidae": {"en": "Thrushes", "vi": "Họ Hoét", "order": "Passeriformes"},
    "Muscicapidae": {"en": "Old World Flycatchers, Chats", "vi": "Họ Đớp ruồi / Oanh", "order": "Passeriformes"},
    "Cinclidae": {"en": "Dippers", "vi": "Họ Lội suối", "order": "Passeriformes"},
    "Passeridae": {"en": "Old World Sparrows", "vi": "Họ Chim sẻ", "order": "Passeriformes"},
    "Ploceidae": {"en": "Weavers", "vi": "Họ Rồng rộc", "order": "Passeriformes"},
    "Estrildidae": {"en": "Waxbills and Allies", "vi": "Họ Mai hoa", "order": "Passeriformes"},
    "Prunellidae": {"en": "Accentors", "vi": "Họ Chích chòe nước", "order": "Passeriformes"},
    "Motacillidae": {"en": "Wagtails and Pipits", "vi": "Họ Chìa vôi / Manh", "order": "Passeriformes"},
    "Fringillidae": {"en": "Finches, Euphonias", "vi": "Họ Sẻ thông", "order": "Passeriformes"},
    "Emberizidae": {"en": "Old World Buntings", "vi": "Họ Sẻ đồng", "order": "Passeriformes"},
}

BIRD_GENUS_PREFIX = {
    "Passer": "Sẻ", "Ardeola": "Cò bợ", "Egretta": "Cò trắng", "Ardea": "Diệc",
    "Ixobrychus": "Cò lửa", "Nycticorax": "Vạc", "Dicrurus": "Chèo bẻo", "Phylloscopus": "Chích lá",
    "Pitta": "Đuôi cụt", "Hydrornis": "Đuôi cụt", "Pycnonotus": "Chào mào", "Hypsipetes": "Cành cạch",
    "Alcedo": "Bồng chanh", "Halcyon": "Sả", "Ceryle": "Bói cá", "Megaceryle": "Bói cá lớn",
    "Merops": "Trảu", "Coracias": "Sả rừng", "Eurystomus": "Yểng quạ", "Buceros": "Hồng hoàng",
    "Anthracoceros": "Cao cát", "Anorrhinus": "Niệc", "Rhyticeros": "Niệc mỏ vằn", "Upupa": "Đầu rìu",
    "Picus": "Gõ kiến xanh", "Chrysophlegma": "Gõ kiến vàng", "Dendrocopos": "Gõ kiến nhỏ",
    "Dryocopus": "Gõ kiến đen", "Centropus": "Bìm bịp", "Cacomantis": "Tìm vịt", "Cuculus": "Cu cu",
    "Eudynamys": "Tu hú", "Surniculus": "Cu cu đen", "Phaenicophaeus": "Phướn", "Columba": "Bồ câu",
    "Streptopelia": "Cu ngói", "Spilopelia": "Cu cườm", "Geopelia": "Cu vằn", "Chalcophaps": "Cu luồng",
    "Treron": "Cu xanh", "Ducula": "Bồ câu rừng", "Gallus": "Gà rừng", "Lophura": "Gà lôi",
    "Polyplectron": "Gà tiền", "Rheinardia": "Trĩ sao", "Pavo": "Công", "Coturnix": "Cút",
    "Arborophila": "Gà so", "Tachybaptus": "Le hôi", "Anhinga": "Điên điển", "Phalacrocorax": "Cốc",
    "Pelecanus": "Bồ nông", "Sula": "Chim điên", "Fregata": "Cốc biển", "Ciconia": "Hạc",
    "Leptoptilos": "Già đui", "Threskiornis": "Cò quăm", "Platalea": "Cò thìa", "Pandion": "Ó cá",
    "Accipiter": "Ưng", "Circus": "Diều đầu đen", "Milvus": "Diều hâu", "Haliastur": "Diều lửa",
    "Haliaeetus": "Đại bàng biển", "Aquila": "Đại bàng", "Spilornis": "Diều hoa", "Falco": "Cắt",
    "Psittacula": "Vẹt", "Loriculus": "Vẹt lùn", "Lanius": "Bách thanh", "Oriolus": "Hoàng anh",
    "Corvus": "Quạ", "Urocissa": "Giẻ cùi", "Dendrocitta": "Khách", "Cissa": "Giẻ cùi xanh",
    "Parus": "Bạc má", "Hirundo": "Nhạn", "Cisticola": "Chiền chiện", "Prinia": "Chiền chiện",
    "Orthotomus": "Chích bông", "Acrocephalus": "Chích đầm lầy", "Garrulax": "Khướu",
    "Trochalopteron": "Khướu", "Leiothrix": "Kim oanh", "Actinodura": "Khướu vằn", "Pomatorhinus": "Khướu mỏ cong",
    "Zosterops": "Vành khuyên", "Sturnia": "Sáo", "Acridotheres": "Sáo đá", "Gracula": "Yểng",
    "Turdus": "Hoét", "Copsychus": "Chích chòe", "Cyornis": "Đớp ruồi", "Ficedula": "Đớp ruồi",
    "Larvivora": "Oanh", "Saxicola": "Sẻ bụi", "Dicaeum": "Chim sâu", "Cinnyris": "Hút mật",
    "Aethopyga": "Hút mật", "Arachnothera": "Bắp chuối", "Lonchura": "Di", "Motacilla": "Chìa vôi",
    "Anthus": "Manh", "Emberiza": "Sẻ đồng"
}

BIRD_NAME_OVERRIDES = {
    "arborophila davidi": "Gà so cổ hung",
    "lophura edwardsi": "Gà lôi lam đuôi trắng",
    "polyplectron germaini": "Gà tiền mặt đỏ",
    "prinia rocki": "Chiền chiện An Nam",
    "locustella idonea": "Chích bụi Đà Lạt",
    "psittiparus margaritae": "Khướu mỏ dẹt đầu đen",
    "schoeniparus klossi": "Lách tách đầu đen",
    "napothera pasquieri": "Khướu đá họng trắng",
    "cutia legalleni": "Khướu hông đỏ",
    "garrulax milleti": "Khướu đầu đen",
    "garrulax annamensis": "Khướu ngực cam",
    "ianthocincla konkakinhensis": "Khướu tai hung",
    "trochalopteron ngoclinhense": "Khướu Ngọc Linh",
    "trochalopteron yersini": "Khướu đầu đen má xám",
    "laniellus langbianis": "Mi Langbiang",
    "actinodura sodangorum": "Khướu vằn đầu đen",
    "chloris monguilloti": "Sẻ thông họng vàng",
    "spilopelia chinensis": "Cu cườm (Cu gáy)",
    "geopelia striata": "Cu vằn",
    "columba pulchricollis": "Bồ câu đầu xám",
    "treron phyayrei": "Cu xanh đầu xám",
    "clamator jacobinus": "Cu cu khoang",
    "hierococcyx sparverioides": "Cu cu cú lớn",
    "hierococcyx hyperythrus": "Cu cu cú phương Bắc",
    "hierococcyx nisicolor": "Cu cu cú nhỏ",
    "cuculus optatus": "Cu cu phương Đông",
    "batrachostomus affinis": "Cú muỗi mỏ quặp Blyth",
    "caprimulgus jotaka": "Cú muỗi xám phương Bắc",
    "aerodramus maximus": "Yến tổ đen",
    "apus cooki": "Yến Cook",
    "rallus indicus": "Gà nước Á Đông",
    "crex crex": "Gà nước ngô",
    "lewinia striata": "Gà nước họng nâu",
    "porphyrio poliocephalus": "Xít (Trích mồng đỏ)",
    "podiceps cristatus": "Le hôi mào lớn",
    "charadrius dealbatus": "Choắt mặt trắng",
    "charadrius hiaticula": "Choắt khoang cổ Á-Âu",
    "calidris pygmea": "Rẽ mỏ thìa",
    "calidris melanotos": "Dẽ ngực đốm",
    "saundersilarus saundersi": "Mòng bể Saunders",
    "chroicocephalus ridibundus": "Mòng bể đầu đen",
    "chroicocephalus brunnicephalus": "Mòng bể đầu nâu",
    "ichthyaetus relictus": "Mòng bể di tích",
    "ichthyaetus ichthyaetus": "Mòng bể Pallas",
    "larus crassirostris": "Mòng bể đuôi đen",
    "larus fuscus": "Mòng bể lưng đen nhỏ",
    "gygis candida": "Nhạn biển trắng",
    "onychoprion fuscatus": "Nhạn biển muội than",
    "onychoprion anaethetus": "Nhạn biển lưng xám",
    "sternula albifrons": "Nhạn biển bé",
    "gelochelidon nilotica": "Nhạn biển mỏ quạ",
    "hydroprogne caspia": "Nhạn biển Caspi",
    "chlidonias hybrida": "Nhạn đen má trắng",
    "chlidonias leucopterus": "Nhạn đen cánh trắng",
    "thalasseus bergii": "Nhạn biển mào lớn",
    "thalasseus bengalensis": "Nhạn biển mào nhỏ",
    "thalasseus bernsteini": "Nhạn biển mào Trung Hoa",
    "sterna dougallii": "Nhạn biển hồng",
    "sterna sumatrana": "Nhạn biển gáy đen",
    "sterna hirundo": "Nhạn biển thông thường",
    "ciconia boyciana": "Hạc trắng phương Đông",
    "ardea insignis": "Diệc bụng trắng",
    "butorides striata": "Cò xanh (Cò lùn xám)",
    "platalea minor": "Cò thìa mặt đen",
    "threskiornis melanocephalus": "Cò quăm đầu đen",
    "pseudibis davisoni": "Cò quăm cánh xanh",
    "thaumatibis gigantea": "Cò quăm lớn",
    "plegadis falcinellus": "Cò quăm đen",
    "nisaetus nipalensis": "Diều núi",
    "nisaetus alboniger": "Diều đen trắng",
    "nisaetus nanus": "Diều nhỏ Wallace",
    "aquila nipalensis": "Đại bàng thảo nguyên",
    "aquila heliaca": "Đại bàng hoàng đế",
    "haliaeetus albicilla": "Đại bàng biển đuôi trắng",
    "circus spilonotus": "Diều đầu đen phương Đông",
    "circus aeruginosus": "Diều đầm lầy phương Tây",
    "circus cyaneus": "Diều xám",
    "circus melanoleucos": "Diều mướp",
    "accipiter nisus": "Ưng lưng xám (Ưng cắt)",
    "accipiter virgatus": "Ưng ba vạch",
    "accipiter gularis": "Ưng Nhật Bản",
    "bubo bubo": "Dù dì Á-Âu",
    "ketupa zeylonensis": "Dù dì phương nâu",
    "ketupa ketupu": "Dù dì Mã Lai",
    "ketupa flavipes": "Dù dì vàng",
    "strix nivicolum": "Cú rừng Himalaya",
    "glaucidium brodiei": "Cú vọ khoang cổ",
    "glaucidium cuculoides": "Cú vọ vằn",
    "athene brama": "Cú vọ chấm đốm",
    "ninox scutulata": "Cú vọ lưng nâu",
    "harpactes oreskios": "Nuốc bụng vàng",
    "harpactes erythrocephalus": "Nuốc bụng đỏ",
    "harpactes wardi": "Nuốc Ward",
    "alcedo meninting": "Bồng chanh tai xanh",
    "alcedo hercules": "Bồng chanh rừng",
    "ceyx erithaca": "Bồng chanh đỏ",
    "pelargopsis capensis": "Sả mỏ rộng",
    "halcyon coromanda": "Sả hung",
    "halcyon smyrnensis": "Sả đầu nâu",
    "halcyon pileata": "Sả đầu đen",
    "todiramphus chloris": "Sả khoang cổ",
    "actenoides concretus": "Sả cổ hung",
    "merops viridis": "Trảu họng xanh",
    "merops philippinus": "Trảu đuôi xanh",
    "merops leschenaulti": "Trảu đầu hung",
    "nyctyornis athertoni": "Trảu mào xanh",
    "psilopogon faiostrictus": "Cu rọc tai xanh",
    "psilopogon lineatus": "Cu rọc ngực sọc",
    "psilopogon franklinii": "Cu rọc tai vàng",
    "psilopogon oorti": "Cu rọc mày đen",
    "psilopogon annamensis": "Cu rọc ngực vàng An Nam",
    "psilopogon lagrandieri": "Cu rọc đốm đỏ",
    "psilopogon incognitus": "Cu rọc ria mép chuỗi",
    "psilopogon asiaticus": "Cu rọc họng xanh",
    "psilopogon monticola": "Cu rọc núi",
    "psilopogon haemacephalus": "Cu rọc đầu đỏ",
    "sasia ochracea": "Gõ kiến lùn mày trắng",
    "picumnus innominatus": "Gõ kiến lùn đốm sao",
    "yungipicus canicapillus": "Gõ kiến nhỏ trán xám",
    "dendrocopos analis": "Gõ kiến đốm ngực nâu",
    "dendrocopos atratus": "Gõ kiến đốm ngực sọc",
    "dendrocopos macei": "Gõ kiến đốm Mace",
    "dendrocopos darjellensis": "Gõ kiến sọc Darjeeling",
    "dendrocopos major": "Gõ kiến đốm lớn",
    "dryobates cathpharius": "Gõ kiến ngực đỏ tươi",
    "dryobates pernii": "Gõ kiến ngực đỏ thắm",
    "leiopicus mahrattensis": "Gõ kiến bụng vàng",
    "micropternus brachyurus": "Gõ kiến nâu",
    "gecolinus grantia": "Gõ kiến xanh đầu nhạt",
    "blythipicus pyrrhotis": "Gõ kiến đầu hung",
    "blythipicus rubiginosus": "Gõ kiến hạt dẻ",
    "reinwardtipicus validus": "Gõ kiến lưng cam lửa",
    "chrysocolaptes guttacristatus": "Gõ kiến vàng lớn",
    "dinopium javanense": "Gõ kiến vàng ba ngón",
    "garrulax castanotis": "Khướu má hung",
    "ianthocincla cineracea": "Khướu mỏ vàng",
    "ianthocincla rufogularis": "Khướu cằm hung",
    "trochalopteron subunicolor": "Khướu vảy",
    "trochalopteron squamatum": "Khướu cánh xanh",
    "trochalopteron affine": "Khướu mặt đen núi",
    "trochalopteron melanostigma": "Khướu tai bạc",
    "trochalopteron formosum": "Khướu cánh đỏ",
    "trochalopteron milnei": "Khướu đuôi đỏ",
    "pterorhinus pectoralis": "Khướu ngực đốm",
    "pterorhinus albogularis": "Khướu họng trắng",
    "pterorhinus chinensis": "Khướu bạc má",
    "pterorhinus vassali": "Khướu Vassal",
    "pterorhinus gularis": "Khướu họng hung",
    "pterorhinus sannio": "Khướu mặt đen",
    "actinodura cyanouroptera": "Khướu lùn đuôi xanh",
    "actinodura strigula": "Khướu lùn đuôi hung",
    "leioptila annectens": "Mi lưng hung",
    "heterophasia desgodinsi": "Mi đầu đen",
    "liocichla ripponi": "Khướu mặt đỏ",
    "schoeniparus castaneceps": "Lách tách cánh hung",
    "schoeniparus cinereus": "Lách tách họng vàng",
    "schoeniparus rufogularis": "Lách tách họng hung",
    "schoeniparus brunneus": "Lách tách nâu",
    "schoeniparus dubius": "Lách tách mũ hung",
    "alcippe grotei": "Lách tách mày đen",
    "alcippe davidi": "Lách tách David",
    "napothera danjoui": "Khướu đá mỏ ngắn",
    "gypsophila annamensis": "Khướu đá vôi An Nam",
    "gypsophila brevicaudatus": "Khướu đá đuôi cụt",
    "spelaeornis kinneari": "Khướu đuôi cụt họng nhạt",
    "spelaeornis troglodytoides": "Khướu đuôi cụt cánh vằn",
    "stachyris nonggangensis": "Khướu Lộng Cương",
    "pomatorhinus superciliaris": "Khướu mỏ cong mảnh",
    "erythrogenys hypoleucos": "Khướu mỏ cong bụng trắng",
    "erythrogenys erythrogenys": "Khướu mỏ cong má hung",
    "erythrogenys gravivox": "Khướu mỏ cong ngực sọc",
    "mixornis gularis": "Chích chạch má vàng",
    "mixornis kelleyi": "Chích chạch mặt xám",
    "cyanoderma chrysaeum": "Chích chạch vàng",
    "cyanoderma ruficeps": "Chích chạch đầu hung",
    "cyanoderma ambiguum": "Chích chạch ngực vàng",
    "gampsorhynchus torquatus": "Khướu mỏ quạ khoang cổ",
    "graminicola striatus": "Chích đuôi dài Trung Hoa",
    "psittiparus gularis": "Khướu mỏ dẹt đầu xám",
    "psittiparus bakeri": "Khướu mỏ dẹt đầu hung",
    "chleuasicus atrosuperciliaris": "Khướu mỏ dẹt mày đen",
    "sinosuthora webbiana": "Khướu mỏ dẹt họng hồng",
    "sinosuthora alphonsiana": "Khướu mỏ dẹt họng xám",
    "suthora nipalensis": "Khướu mỏ dẹt họng đen",
    "suthora verreauxi": "Khướu mỏ dẹt vàng",
    "neosuthora davidiana": "Khướu mỏ dẹt đuôi ngắn",
    "fulvetta danisi": "Lách tách Đông Dương",
    "fulvetta vinipectus": "Lách tách mày trắng",
    "fulvetta ruficapilla": "Lách tách mũ hung",
    "fulvetta manipurensis": "Lách tách họng sọc",
    "lioparus chrysotis": "Lách tách ngực vàng",
    "parayuhina diademata": "Khướu mào khoang cổ",
    "staphida torqueola": "Khướu mào Đông Dương",
    "sitta solangiae": "Trèo cây mỏ vàng",
    "sitta neglecta": "Trèo cây Miến Điện",
    "certhia manipurensis": "Đuôi gai Manipur",
    "tichodroma muraria": "Trèo vách đá",
    "elachura formosa": "Khướu đốm",
    "aplonis panayensis": "Sáo bóng châu Á",
    "pastor roseus": "Sáo hồng",
    "agropsar sturninus": "Sáo lưng đen",
    "agropsar philippensis": "Sáo má hung",
    "gracupica floweri": "Sáo khoang Xiêm",
    "spodiopsar sericeus": "Sáo mỏ đỏ",
    "spodiopsar cineraceus": "Sáo má trắng",
    "acridotheres leucocephalus": "Cà cưỡng ngực hung",
    "zoothera salimalii": "Hoét Himalaya",
    "zoothera griseiceps": "Hoét Tứ Xuyên",
    "zoothera aurea": "Hoét vàng",
    "geokichla sibirica": "Hoét Siberia",
    "geokichla citrina": "Hoét đầu cam",
    "otocichla mupinensis": "Hoét Trung Hoa",
    "turdus mandarinus": "Hoét đen",
    "turdus pallidus": "Hoét nhạt màu",
    "turdus ruficollis": "Hoét cổ đỏ",
    "turdus eunomus": "Hoét hung",
    "muscicapa williamsoni": "Đớp ruồi sọc nâu",
    "anthipes monileger": "Đớp ruồi vòng cổ trắng",
    "anthipes solitaris": "Đớp ruồi mày hung",
    "cyornis unicolor": "Đớp ruồi lam nhạt",
    "cyornis glaucicomans": "Đớp ruồi xanh Trung Hoa",
    "cyornis whitei": "Đớp ruồi xanh đồi",
    "cyornis sumatrensis": "Đớp ruồi xanh Đông Dương",
    "cyornis brunneatus": "Đớp ruồi rừng ngực nâu",
    "niltava sundara": "Đớp ruồi bụng hung lớn",
    "cyanoptila cumatilis": "Đớp ruồi xanh Zappey",
    "brachypteryx cruralis": "Đoản cánh Himalaya",
    "brachypteryx sinensis": "Đoản cánh Trung Hoa",
    "larvivora sibilans": "Oanh đuôi hung",
    "larvivora akahige": "Oanh Nhật Bản",
    "larvivora cyane": "Oanh đuôi nhọn xanh",
    "luscinia phaenicuroides": "Đuôi đỏ bụng trắng",
    "calliope obscura": "Oanh họng đen",
    "calliope calliope": "Oanh cổ đỏ",
    "myiomela leucura": "Oanh đuôi trắng",
    "tarsiger rufilatus": "Oanh đuôi xanh Himalaya",
    "ficedula elisae": "Đớp ruồi lưng xanh",
    "ficedula erithacus": "Đớp ruồi lưng xám",
    "ficedula hodgsoni": "Đớp ruồi lùn",
    "ficedula albicilla": "Đớp ruồi Taiga",
    "ficedula parva": "Đớp ruồi ngực đỏ",
    "phoenicurus fuliginosus": "Đuôi đỏ nước",
    "phoenicurus leucocephalus": "Đuôi đỏ đầu trắng",
    "saxicola maurus": "Sẻ bụi Siberia",
    "saxicola stejnegeri": "Sẻ bụi Amur",
    "saxicola ferreus": "Sẻ bụi xám",
    "prionochilus thoracicus": "Chim sâu ngực đỏ",
    "dicaeum melanozanthum": "Chim sâu bụng vàng",
    "dicaeum trigonostigma": "Chim sâu bụng cam",
    "dicaeum minullum": "Chim sâu mỏ ngắn",
    "leptocoma brasiliana": "Hút mật Van Hasselt",
    "kurochkinegramma hypogrammicum": "Hút mật gáy tím",
    "chloropsis cochinchinensis": "Chim xanh Nam Bộ",
    "passer cinnamomeus": "Sẻ hung",
    "motacilla tschutschensis": "Chìa vôi vàng phương Đông",
    "motacilla samveasnae": "Chìa vôi sông Mekong",
    "anthus richardi": "Manh Richard",
    "anthus sylvanus": "Manh vùng cao",
    "eophona personata": "Mỏ to Nhật Bản",
    "carpodacus sipahi": "Sẻ đỏ tươi",
    "carpodacus vinaceus": "Sẻ hồng rượu",
    "pyrrhula erythaca": "Sẻ đầu xám",
    "procarduelis nipalensis": "Sẻ hồng ngực tối",
    "chloris sinica": "Sẻ thông phương Đông",
    "chloris ambigua": "Sẻ thông đầu đen",
    "spinus spinus": "Sẻ thông Á-Âu",
    "emberiza lathami": "Sẻ đồng mào",
    "emberiza melanocephala": "Sẻ đồng đầu đen",
    "emberiza bruniceps": "Sẻ đồng đầu đỏ",
    "emberiza godlewskii": "Sẻ đồng đá Godlewski",
    "emberiza buchanani": "Sẻ đồng cổ xám",
    "emberiza elegans": "Sẻ đồng họng vàng",
    "emberiza pallasi": "Sẻ đồng Pallas",
    "emberiza schoeniclus": "Sẻ đồng đầm lầy",
    "emberiza rustica": "Sẻ đồng đuôi nhọn",
    "emberiza tristrami": "Sẻ đồng Tristram",
    "phylloscopus valentini": "Chích lá Bianchi",
    "phylloscopus omeiensis": "Chích lá Nga Mi",
    "phylloscopus soror": "Chích lá Alström",
    "phylloscopus plumbeitarsus": "Chích lá hai vạch",
    "phylloscopus castaniceps": "Chích lá đầu hung",
    "phylloscopus calciatilis": "Chích lá núi đá vôi",
    "phylloscopus cantator": "Chích lá bụng vàng",
    "phylloscopus claudiae": "Chích lá Claudia",
    "phylloscopus goodsoni": "Chích lá Hartert",
    "phylloscopus intensior": "Chích lá Davison",
    "phylloscopus ogilviegranti": "Chích lá Kloss",
    "urosphena pallidipes": "Chích đuôi cụt chân nhạt",
    "cettia major": "Chích bụi lớn đầu hung",
    "cettia castaneocoronata": "Đoản cánh đầu hung",
    "phyllergates cuculatus": "Chích bông núi",
    "horornis borealis": "Chích bụi Mãn Châu",
    "horornis fortipes": "Chích bụi sườn nâu",
    "horornis flavolivaceus": "Chích bụi lục nhạt",
    "sibirionetta formosa": "Mòng két Baikal",
    "spatula querquedula": "Mòng két mày trắng",
    "spatula clypeata": "Vịt mỏ thìa",
    "mareca strepera": "Vịt cánh trắng",
    "mareca falcata": "Vịt lưỡi liềm",
    "mareca penelope": "Vịt trời Á-Âu",
    "anas zonorhyncha": "Vịt cổ xanh mỏ đốm phương Đông",
    "asarcornis scutulata": "Vịt rừng cánh trắng",
    "netta rufina": "Vịt lặn mào đỏ",
    "mergus serrator": "Vịt cát ngực đỏ",
    "mergellus albellus": "Vịt cát mào trắng",
    "mergus merganser": "Vịt cát lớn",
    "tropicoperdix chloropus": "Gà so chân xanh",
    "tropicoperdix charltonii": "Gà so họng hung",
    "poliolimnas cinereus": "Cuốc mày trắng",
    "zapornia fusca": "Cuốc ngực nâu",
    "zapornia paykullii": "Cuốc ngực vằn",
    "zapornia akool": "Cuốc nâu",
    "zapornia pusilla": "Cuốc bé",
    "zapornia bicolor": "Cuốc đuôi đen",
    "antigone antigone": "Sếu đầu đỏ",
    "burhinus indicus": "Dẽ dày Ấn Độ",
    "esacus recurvirostris": "Dẽ dày lớn",
    "haematopus ostralegus": "Chim mò sò",
    "numenius madagascariensis": "Choắt mỏ cong hông đen",
    "calidris pugnax": "Dẽ hoa",
    "calidris falcinellus": "Dẽ mỏ rộng",
    "calidris minuta": "Dẽ bé",
    "calidris tenuirostris": "Dẽ mỏ cong lớn",
    "calidris canutus": "Dẽ lưng xám",
    "calidris acuminata": "Dẽ đuôi nhọn",
    "calidris himantopus": "Dẽ cà kheo",
    "calidris ferruginea": "Dẽ mỏ cong",
    "calidris temminckii": "Dẽ ngón dài",
    "calidris subminuta": "Dẽ ngón chân dài",
    "calidris pygmaea": "Rẽ mỏ thìa",
    "calidris ruficollis": "Dẽ cổ đỏ",
    "calidris alba": "Dẽ ba ngón",
    "calidris alpina": "Dẽ bụng đen",
    "scolopax rusticola": "Dẽ gà",
    "actitis hypoleucos": "Choắt nâu",
    "tringa ochropus": "Choắt bụng trắng",
    "tringa erythropus": "Choắt chân đỏ",
    "tringa nebularia": "Choắt lớn",
    "tringa guttifer": "Choắt lớn mỏ cong",
    "tringa stagnatilis": "Choắt đốm đen",
    "tringa glareola": "Choắt lốm đốm",
    "tringa totanus": "Choắt chân đỏ thường",
    "xenus cinereus": "Choắt mỏ cong",
    "phalaropus lobatus": "Rẽ cổ đỏ",
    "limnodromus scolopaceus": "Dẽ mỏ dài",
    "gallinago solitaria": "Dẽ gà cô độc",
    "tringa brevipes": "Choắt xám nhỏ",
    "turnix sylvaticus": "Cút ba ngón nhỏ",
    "turnix tanki": "Cút ba ngón lưng hung",
    "turnix suscitator": "Cút ba ngón họng đen",
    "glareola maldivarum": "Chim vằn phương Đông",
    "glareola lactea": "Chim vằn nhỏ",
    "stercorarius pomarinus": "Cướp biển Pomarine",
    "stercorarius parasiticus": "Cướp biển ký sinh",
    "synthliboramphus antiquus": "Uria cổ đen cổ đại",
    "sterna paradisaea": "Nhạn biển Bắc Cực",
    "sterna aurantia": "Nhạn sông",
    "hydrobates monorhis": "Hải âu Swinhoe",
    "calonectris leucomelas": "Hải âu mặt trắng",
    "ardenna pacifica": "Hải âu đuôi nêm",
    "puffinus nativitatis": "Hải âu Giáng Sinh",
    "fregata ariel": "Cốc biển nhỏ",
    "microcarbo niger": "Cốc lùn",
    "ardea alba": "Cò ngàng lớn",
    "ardea intermedia": "Cò ngàng nhỏ",
    "ardea coromanda": "Cò ruồi",
    "platalea leucorodia": "Cò thìa Á-Âu",
    "nisaetus cirrhatus": "Diều đầu nâu",
    "lophotriorchis kienerii": "Đại bàng bụng hung",
    "ictinaetus malaiensis": "Đại bàng đen",
    "clanga clanga": "Đại bàng đốm lớn",
    "hieraaetus pennatus": "Đại bàng lùn",
    "aquila fasciata": "Đại bàng Bonelli",
    "circus macrourus": "Diều xám thảo nguyên",
    "astur gentilis": "Ưng ngỗng",
    "haliaeetus humilis": "Diều cá bé",
    "haliaeetus ichthyaetus": "Diều cá đầu xám",
    "buteo refectus": "Diều Himalaya",
    "buteo japonicus": "Diều Nhật Bản",
    "tyto longimembris": "Cú lợn đồng cỏ",
    "tyto javanica": "Cú lợn lưng xám",
    "taenioptynx brodiei": "Cú vọ khoang cổ",
    "asio otus": "Cú mèo tai dài",
    "ninox japonica": "Cú vọ phương Bắc",
    "berenicornis comatus": "Niệc đầu trắng",
    "anorrhinus austeni": "Niệc nâu",
    "rhyticeros undulatus": "Niệc mỏ vằn",
    "merops leschenaultia": "Trảu đầu hung",
    "coracias affinis": "Sả rừng Đông Dương",
    "psilopogon duvaucelii": "Cu rọc tai xanh nhỏ",
    "psilopogon virens": "Cu rọc lớn",
    "psilopogon auricularis": "Cu rọc khoang cổ",
    "chrysophlegma flavinucha": "Gõ kiến vàng lớn",
    "hydrornis phayrei": "Đuôi cụt tai",
    "hydrornis oatesi": "Đuôi cụt gáy hung",
    "hydrornis nipalensis": "Đuôi cụt gáy xanh",
    "hydrornis soror": "Đuôi cụt đầu lam",
    "hydrornis cyanea": "Đuôi cụt đầu đỏ",
    "hydrornis elliotii": "Đuôi cụt bụng vằn",
    "lalage melaschistos": "Phường chèo xám lớn",
    "lalage polioptera": "Phường chèo xám Đông Dương",
    "pteruthius aeralatus": "Khướu bách thanh mày trắng",
    "pteruthius xanthochlorus": "Khướu bách thanh xanh",
    "pteruthius intermedius": "Khướu bách thanh hạt dẻ",
    "erpornis zantholeuca": "Khướu mào bụng trắng",
    "pachycephala cinerea": "Bách thanh rừng ngập mặn",
    "oriolus mellianus": "Hoàng anh bạc",
    "dicrurus annectens": "Chèo bẻo mỏ quạ",
    "terpsiphone incei": "Thiên đường đuôi phướn Amur",
    "terpsiphone affinis": "Thiên đường đuôi phướn Blyth",
    "lanius bucephalus": "Bách thanh đầu bò",
    "pica serica": "Ác là",
    "nucifraga caryocatactes": "Bổ hạt",
    "corvus splendens": "Quạ nhà",
    "chelidorhynx hypoxanthus": "Rẻ quạt bụng vàng",
    "parus cinereus": "Bạc má tro",
    "parus minor": "Bạc má Nhật Bản",
    "machlolophus spilonotus": "Bạc má má vàng",
    "remiz consobrinus": "Phàn mĩu Trung Hoa",
    "alaudala cheleensis": "Sơn ca ngón ngắn",
    "orthotomus ruficeps": "Chích bông đầu hung",
    "prinia superciliaris": "Chiền chiện núi",
    "arundinax aedon": "Chích sậy mỏ to",
    "acrocephalus agricola": "Chích sậy đồng lúa",
    "acrocephalus concinens": "Chích sậy cánh ngắn",
    "acrocephalus tangorum": "Chích sậy Mãn Châu",
    "helopsaltes certhiola": "Chích bụi Pallas",
    "helopsaltes pleskei": "Chích bụi Pleske",
    "locustella luteoventris": "Chích bụi bụng vàng",
    "locustella tacsanowskia": "Chích bụi Trung Hoa",
    "locustella davidi": "Chích bụi Baikal",
    "locustella mendelli": "Chích bụi nâu đỏ",
    "riparia chinensis": "Nhạn họng xám",
    "cecropis striolata": "Nhạn bụng sọc",
    "delichon urbicum": "Nhạn nhà Á-Âu",
    "delichon nipalense": "Nhạn nhà Nepal",
    "brachypodius melanocephalos": "Chào mào đầu đen",
    "pycnonotus conradi": "Chào mào tai sọc",
    "ixos malaccensis": "Cành cạch Malacca",
    "phylloscopus humei": "Chích lá Hume",
    "phylloscopus yunnanensis": "Chích lá Vân Nam",
    "phylloscopus kansuensis": "Chích lá Cam Túc",
    "phylloscopus forresti": "Chích lá Tứ Xuyên",
    "phylloscopus armandii": "Chích lá họng sọc",
    "phylloscopus collybita": "Chích lá Á-Âu",
    "phylloscopus affinis": "Chích lá mày vàng",
    "phylloscopus poliogenys": "Chích lá má xám",
    "phylloscopus tephrocephalus": "Chích lá đầu xám"
}


BF_FAMILY_MAP = {
    "Papilionidae": {"en": "Swallowtails and Birdwings", "vi": "Họ Bướm phượng"},
    "Pieridae": {"en": "Whites and Yellows", "vi": "Họ Bướm phấn (Bướm cải)"},
    "Nymphalidae": {"en": "Brush-footed Butterflies", "vi": "Họ Bướm giáp"},
    "Lycaenidae": {"en": "Blues, Coppers, Hairstreaks", "vi": "Họ Bướm xanh (Lycaenid)"},
    "Riodinidae": {"en": "Metalmarks", "vi": "Họ Bướm hoa kim (Bướm mào)"},
    "Hesperiidae": {"en": "Skippers", "vi": "Họ Bướm nhảy"}
}

BF_GENUS_MAP = {
    # Papilionidae
    "Troides": ("Bướm phượng cánh chim", "Papilionidae"),
    "Ornithoptera": ("Bướm phượng cánh chim khổng lồ", "Papilionidae"),
    "Papilio": ("Bướm phượng", "Papilionidae"),
    "Graphium": ("Bướm đuôi kiếm", "Papilionidae"),
    "Atrophaneura": ("Bướm phượng đuôi hồng", "Papilionidae"),
    "Byasa": ("Bướm phượng cánh đen", "Papilionidae"),
    "Losaria": ("Bướm phượng thân hồng", "Papilionidae"),
    "Pachliopta": ("Bướm phượng cánh hoa hồng", "Papilionidae"),
    "Lamproptera": ("Bướm đuôi rồng", "Papilionidae"),
    "Teinopalpus": ("Bướm đuôi chém ngọc bích", "Papilionidae"),
    "Meandrusa": ("Bướm đuôi nĩa", "Papilionidae"),
    "Bhutanitis": ("Bướm đuôi kiếm Bhutan", "Papilionidae"),
    # Pieridae
    "Delias": ("Bướm phấn chấm đỏ", "Pieridae"),
    "Catopsilia": ("Bướm phấn vàng di cư", "Pieridae"),
    "Eurema": ("Bướm cỏ vàng", "Pieridae"),
    "Pieris": ("Bướm cải", "Pieridae"),
    "Appias": ("Bướm phấn rừng", "Pieridae"),
    "Hebomoia": ("Bướm phấn đầu cam", "Pieridae"),
    "Prioneris": ("Bướm phấn giả phượng", "Pieridae"),
    "Cepora": ("Bướm phấn gân đen", "Pieridae"),
    "Ixias": ("Bướm phấn chanh đầu vàng", "Pieridae"),
    "Dercas": ("Bướm phấn cánh lưu huỳnh", "Pieridae"),
    "Gandaca": ("Bướm phấn cánh tròn vàng", "Pieridae"),
    "Leptosia": ("Bướm phấn cánh nhỏ", "Pieridae"),
    "Colias": ("Bướm phấn cỏ vàng phương bắc", "Pieridae"),
    "Aporia": ("Bướm phấn cánh trong gân đen", "Pieridae"),
    "Pareronia": ("Bướm phấn giả vằn xanh", "Pieridae"),
    "Saletara": ("Bướm phấn rừng viền đen", "Pieridae"),
    # Nymphalidae
    "Kallima": ("Bướm lá khô", "Nymphalidae"),
    "Sasakia": ("Bướm hoàng đế", "Nymphalidae"),
    "Apatura": ("Bướm hoàng đế tím", "Nymphalidae"),
    "Chitoria": ("Bướm hoàng đế cánh xám", "Nymphalidae"),
    "Sephisa": ("Bướm hoàng đế cánh đốm", "Nymphalidae"),
    "Euripus": ("Bướm hoàng đế rực rỡ", "Nymphalidae"),
    "Hestina": ("Bướm hoàng đế giả vằn", "Nymphalidae"),
    "Helcyra": ("Bướm hoàng đế trắng ngọc", "Nymphalidae"),
    "Mimathyma": ("Bướm hoàng đế đốm trắng", "Nymphalidae"),
    "Charaxes": ("Bướm hoàng tử", "Nymphalidae"),
    "Polyura": ("Bướm hoàng tử hai đuôi", "Nymphalidae"),
    "Cyrestis": ("Bướm bản đồ", "Nymphalidae"),
    "Chersonesia": ("Bướm bản đồ nhỏ", "Nymphalidae"),
    "Neptis": ("Bướm ba vạch", "Nymphalidae"),
    "Phaedyma": ("Bướm ba vạch lớn", "Nymphalidae"),
    "Pantoporia": ("Bướm ba vạch cam", "Nymphalidae"),
    "Lasippa": ("Bướm ba vạch vàng", "Nymphalidae"),
    "Athyma": ("Bướm thủy thủ", "Nymphalidae"),
    "Moduza": ("Bướm thủy thủ cánh đỏ", "Nymphalidae"),
    "Limenitis": ("Bướm đô đốc", "Nymphalidae"),
    "Parthenos": ("Bướm cánh bạc sao", "Nymphalidae"),
    "Lebadea": ("Bướm thủy thủ viền gợn", "Nymphalidae"),
    "Euthalia": ("Bướm giáp rừng", "Nymphalidae"),
    "Lexias": ("Bướm giáp cánh chấm", "Nymphalidae"),
    "Tanaecia": ("Bướm giáp viền tím", "Nymphalidae"),
    "Dophla": ("Bướm giáp công tước", "Nymphalidae"),
    "Bassarona": ("Bướm giáp rừng lớn", "Nymphalidae"),
    "Cethosia": ("Bướm đăng ten", "Nymphalidae"),
    "Vindula": ("Bướm cánh du thuyền", "Nymphalidae"),
    "Cirrochroa": ("Bướm hoàng thổ", "Nymphalidae"),
    "Cupha": ("Bướm hoàng thổ nhỏ", "Nymphalidae"),
    "Phalanta": ("Bướm báo đốm", "Nymphalidae"),
    "Vagrans": ("Bướm hoàng thổ đuôi nhọn", "Nymphalidae"),
    "Argynnis": ("Bướm hoa cỏ báo", "Nymphalidae"),
    "Argyreus": ("Bướm hoa cỏ viền bạc", "Nymphalidae"),
    "Junonia": ("Bướm hoa cỏ", "Nymphalidae"),
    "Precis": ("Bướm hoa cỏ sẫm", "Nymphalidae"),
    "Vanessa": ("Bướm hồng đô đốc", "Nymphalidae"),
    "Kaniska": ("Bướm giáp cánh xanh lam", "Nymphalidae"),
    "Symbrenthia": ("Bướm giáp hoa văn hề", "Nymphalidae"),
    "Hypolimnas": ("Bướm giáp hoa râm cánh trứng", "Nymphalidae"),
    "Yoma": ("Bướm giáp cánh dơi viền vàng", "Nymphalidae"),
    "Rhinopalpa": ("Bướm giáp cánh nhọn phù thủy", "Nymphalidae"),
    "Doleschallia": ("Bướm lá mùa thu", "Nymphalidae"),
    "Danaus": ("Bướm hổ", "Nymphalidae"),
    "Tirumala": ("Bướm hổ gân xanh", "Nymphalidae"),
    "Parantica": ("Bướm gân xanh đốm", "Nymphalidae"),
    "Euploea": ("Bướm quạ", "Nymphalidae"),
    "Idea": ("Bướm cánh giấy", "Nymphalidae"),
    "Ideopsis": ("Bướm gân xanh nhỏ", "Nymphalidae"),
    "Elymnias": ("Bướm mắt cọ", "Nymphalidae"),
    "Lethe": ("Bướm cỏ mắt rừng", "Nymphalidae"),
    "Neope": ("Bướm mắt rừng vằn xám", "Nymphalidae"),
    "Zophoessa": ("Bướm mắt rừng đuôi nhọn", "Nymphalidae"),
    "Mycalesis": ("Bướm mắt bụi", "Nymphalidae"),
    "Ypthima": ("Bướm mắt ba vòng", "Nymphalidae"),
    "Melanitis": ("Bướm mắt hoàng hôn", "Nymphalidae"),
    "Coelites": ("Bướm mắt tím ngọc", "Nymphalidae"),
    "Neorina": ("Bướm mắt cú khổng lồ", "Nymphalidae"),
    "Orsotriaena": ("Bướm cỏ một vạch", "Nymphalidae"),
    "Amathusia": ("Bướm chuối", "Nymphalidae"),
    "Amathuxidia": ("Bướm chuối tím ngọc", "Nymphalidae"),
    "Zeuxidia": ("Bướm chuối dải lam", "Nymphalidae"),
    "Discophora": ("Bướm chuối đốm xanh", "Nymphalidae"),
    "Thaumantis": ("Bướm rừng lấp lánh", "Nymphalidae"),
    "Stichophthalma": ("Bướm nữ hoàng rừng", "Nymphalidae"),
    "Faunis": ("Bướm rừng nâu nhạt", "Nymphalidae"),
    "Libythea": ("Bướm mỏ dài", "Nymphalidae"),
    "Calinaga": ("Bướm giáp mập giả quạ", "Nymphalidae"),
    # Lycaenidae
    "Arhopala": ("Bướm sồi xanh tím", "Lycaenidae"),
    "Flos": ("Bướm sồi đuôi nhọn", "Lycaenidae"),
    "Surendra": ("Bướm xanh chân cong", "Lycaenidae"),
    "Zinaspa": ("Bướm xanh đuôi bạc", "Lycaenidae"),
    "Deudorix": ("Bướm xanh đuôi nhọn", "Lycaenidae"),
    "Virachola": ("Bướm xanh đốm ổi", "Lycaenidae"),
    "Rapala": ("Bướm xanh đuôi nheo", "Lycaenidae"),
    "Tajuria": ("Bướm xanh hoàng gia", "Lycaenidae"),
    "Pratapa": ("Bướm xanh vương giả", "Lycaenidae"),
    "Dacalana": ("Bướm xanh hoàng gia vạch trắng", "Lycaenidae"),
    "Cheritra": ("Bướm xanh đuôi dài", "Lycaenidae"),
    "Ticherra": ("Bướm xanh đuôi lông", "Lycaenidae"),
    "Drupadia": ("Bướm xanh sọc nâu", "Lycaenidae"),
    "Horaga": ("Bướm xanh ba đuôi", "Lycaenidae"),
    "Loxura": ("Bướm xanh đuôi kiếm cam", "Lycaenidae"),
    "Yasoda": ("Bướm xanh đuôi kiếm vằn", "Lycaenidae"),
    "Eooxylides": ("Bướm xanh đuôi kiếm cánh xám", "Lycaenidae"),
    "Sinthusa": ("Bướm xanh đuôi ngắn", "Lycaenidae"),
    "Bindahara": ("Bướm xanh đuôi đĩa", "Lycaenidae"),
    "Spindasis": ("Bướm xanh vằn bạc", "Lycaenidae"),
    "Cigaritis": ("Bướm xanh vằn bạc", "Lycaenidae"),
    "Zizeeria": ("Bướm xanh cỏ nhỏ", "Lycaenidae"),
    "Zizina": ("Bướm xanh cỏ thường", "Lycaenidae"),
    "Zizula": ("Bướm xanh cỏ tí hon", "Lycaenidae"),
    "Chilades": ("Bướm xanh cỏ ngọc", "Lycaenidae"),
    "Euchrysops": ("Bướm xanh đốm mắt", "Lycaenidae"),
    "Catochrysops": ("Bướm xanh cỏ đuôi dài", "Lycaenidae"),
    "Lampides": ("Bướm xanh đậu biếc", "Lycaenidae"),
    "Jamides": ("Bướm xanh vân xám", "Lycaenidae"),
    "Nacaduba": ("Bướm xanh vân lượn", "Lycaenidae"),
    "Prosotas": ("Bướm xanh vân lượn không đuôi", "Lycaenidae"),
    "Ionolyce": ("Bướm xanh vân lượn đuôi nhọn", "Lycaenidae"),
    "Petrelaea": ("Bướm xanh vân lượn lấp lánh", "Lycaenidae"),
    "Acytolepis": ("Bướm xanh rừng", "Lycaenidae"),
    "Celastrina": ("Bướm xanh bụi", "Lycaenidae"),
    "Udara": ("Bướm xanh núi cao", "Lycaenidae"),
    "Pithecops": ("Bướm xanh trắng đốm mắt", "Lycaenidae"),
    "Neopithecops": ("Bướm xanh trắng không đuôi", "Lycaenidae"),
    "Megisba": ("Bướm xanh đốm đen mắt", "Lycaenidae"),
    "Castalius": ("Bướm xanh trắng đốm hoa", "Lycaenidae"),
    "Caleta": ("Bướm xanh cánh vằn", "Lycaenidae"),
    "Heliophorus": ("Bướm xanh đuôi sapphire", "Lycaenidae"),
    "Curetis": ("Bướm mặt trời cánh bạc", "Lycaenidae"),
    "Poritia": ("Bướm xanh đốm ngọc", "Lycaenidae"),
    "Simiskina": ("Bướm xanh đốm ngọc nhỏ", "Lycaenidae"),
    "Miletus": ("Bướm thịt ăn rệp", "Lycaenidae"),
    "Allotinus": ("Bướm sọc ăn rệp", "Lycaenidae"),
    "Spalgis": ("Bướm ăn rệp vảy", "Lycaenidae"),
    "Taraka": ("Bướm ăn rệp chấm đen", "Lycaenidae"),
    "Liphyra": ("Bướm kiến khổng lồ", "Lycaenidae"),
    # Riodinidae
    "Abisara": ("Bướm mào đuôi nĩa", "Riodinidae"),
    "Dodona": ("Bướm đuôi chùy", "Riodinidae"),
    "Zemeros": ("Bướm hoa kim nâu", "Riodinidae"),
    "Stiboges": ("Bướm hoa kim cánh trong", "Riodinidae"),
    "Laxita": ("Bướm hoa kim ngọc đỏ", "Riodinidae"),
    "Paralaxita": ("Bướm hoa kim đốm đỏ", "Riodinidae"),
    "Taxila": ("Bướm hoa kim viền vàng", "Riodinidae"),
    # Hesperiidae
    "Badamia": ("Bướm nhảy cánh nhọn", "Hesperiidae"),
    "Bibasis": ("Bướm nhảy mắt cam", "Hesperiidae"),
    "Burara": ("Bướm nhảy sọc cam lớn", "Hesperiidae"),
    "Choaspes": ("Bướm nhảy vua", "Hesperiidae"),
    "Hasora": ("Bướm nhảy đuôi nheo", "Hesperiidae"),
    "Celaenorrhinus": ("Bướm nhảy đốm vàng đục", "Hesperiidae"),
    "Tagiades": ("Bướm nhảy đốm tuyết", "Hesperiidae"),
    "Darpa": ("Bướm nhảy cánh vân", "Hesperiidae"),
    "Odontoptilum": ("Bướm nhảy cánh răng cưa", "Hesperiidae"),
    "Capila": ("Bướm nhảy sọc đen trắng", "Hesperiidae"),
    "Coladenia": ("Bướm nhảy loang", "Hesperiidae"),
    "Pseudocoladenia": ("Bướm nhảy loang cánh nhung", "Hesperiidae"),
    "Sarangesa": ("Bướm nhảy đốm nhỏ", "Hesperiidae"),
    "Seseria": ("Bướm nhảy cánh rộng vạch trắng", "Hesperiidae"),
    "Notocrypta": ("Bướm nhảy vạch trắng", "Hesperiidae"),
    "Udaspes": ("Bướm nhảy gừng", "Hesperiidae"),
    "Suastus": ("Bướm nhảy cỏ cọ", "Hesperiidae"),
    "Ancistroides": ("Bướm nhảy cánh socola", "Hesperiidae"),
    "Iambrix": ("Bướm nhảy cánh sao đốm", "Hesperiidae"),
    "Koruthaialos": ("Bướm nhảy vạch nhung đỏ", "Hesperiidae"),
    "Psolos": ("Bướm nhảy đen tuyền", "Hesperiidae"),
    "Astictopterus": ("Bướm nhảy cánh mờ", "Hesperiidae"),
    "Ampittia": ("Bướm nhảy cỏ đốm vàng", "Hesperiidae"),
    "Aeromachus": ("Bướm nhảy cỏ tí hon", "Hesperiidae"),
    "Halpe": ("Bướm nhảy rừng nhỏ", "Hesperiidae"),
    "Thoressa": ("Bướm nhảy rừng đốm chấm", "Hesperiidae"),
    "Pedesta": ("Bướm nhảy rừng cánh vàng", "Hesperiidae"),
    "Zographetus": ("Bướm nhảy đốm tím", "Hesperiidae"),
    "Hyarotis": ("Bướm nhảy đốm viền", "Hesperiidae"),
    "Quedara": ("Bướm nhảy rừng cánh nâu", "Hesperiidae"),
    "Isoteinon": ("Bướm nhảy cỏ đốm trắng", "Hesperiidae"),
    "Pyroneura": ("Bướm nhảy gân cam", "Hesperiidae"),
    "Plastingia": ("Bướm nhảy gân vàng bạc", "Hesperiidae"),
    "Lotongus": ("Bướm nhảy cỏ dừa", "Hesperiidae"),
    "Gangara": ("Bướm nhảy chuối khổng lồ", "Hesperiidae"),
    "Erionota": ("Bướm nhảy chuối", "Hesperiidae"),
    "Matapa": ("Bướm nhảy mắt đỏ", "Hesperiidae"),
    "Taractrocera": ("Bướm nhảy cỏ vàng nhỏ", "Hesperiidae"),
    "Oriens": ("Bướm nhảy cỏ dải cam", "Hesperiidae"),
    "Potanthus": ("Bướm nhảy phi tiêu", "Hesperiidae"),
    "Telicota": ("Bướm nhảy hoa cam", "Hesperiidae"),
    "Cephrenes": ("Bướm nhảy dừa lớn", "Hesperiidae"),
    "Parnara": ("Bướm nhảy cỏ thường", "Hesperiidae"),
    "Borbo": ("Bướm nhảy đồng lúa", "Hesperiidae"),
    "Pelopidas": ("Bướm nhảy lúa", "Hesperiidae"),
    "Polytremis": ("Bướm nhảy đốm nâu", "Hesperiidae"),
    "Baoris": ("Bướm nhảy đuôi nhọn", "Hesperiidae"),
    "Caltoris": ("Bướm nhảy nâu nhạt", "Hesperiidae"),
    "Iton": ("Bướm nhảy cánh xám", "Hesperiidae")
}

BF_NAME_OVERRIDES = {
    "troides helena": "Bướm phượng cánh chim",
    "troides aeacus": "Bướm phượng cánh chim chấm liền",
    "teinopalpus aureus": "Bướm đuôi chém ngọc bích",
    "papilio demoleus": "Bướm phượng chanh",
    "papilio polytes": "Bướm phượng mormon",
    "papilio memnon": "Bướm đại phượng",
    "papilio paris": "Bướm phượng đuôi công",
    "papilio helenus": "Bướm phượng đốm đỏ",
    "papilio nephelus": "Bướm phượng sao vàng",
    "papilio protenor": "Bướm phượng đuôi nheo đen",
    "graphium sarpedon": "Bướm chai xanh",
    "graphium doson": "Bướm đuôi kiếm vạch xanh",
    "graphium agamemnon": "Bướm đuôi kiếm đốm xanh",
    "graphium antiphates": "Bướm đuôi kiếm đốm vàng",
    "lamproptera curius": "Bướm đuôi rồng trắng",
    "lamproptera meges": "Bướm đuôi rồng xanh",
    "meandrusa payeni": "Bướm đuôi nĩa vàng",
    "kallima inachus": "Bướm lá khô",
    "sasakia charonda": "Bướm hoàng đế",
    "apatura ambica": "Bướm hoàng đế tím viền trắng",
    "sephisa chandra": "Bướm hoàng đế cánh đốm cam",
    "charaxes bernardus": "Bướm hoàng tử cánh nâu đốm",
    "polyura athamas": "Bướm hoàng tử hai đuôi vạch xanh",
    "cyrestis cocles": "Bướm bản đồ vằn trắng",
    "cyrestis themire": "Bướm bản đồ viền nâu",
    "cyrestis thyodamas": "Bướm bản đồ thường",
    "chersonesia rahria": "Bướm bản đồ nhỏ cánh gợn",
    "neptis hylas": "Bướm ba vạch thường",
    "neptis soma": "Bướm ba vạch vằn đen",
    "neptis clinia": "Bướm ba vạch cánh trong",
    "athyma perius": "Bướm thủy thủ chấm trắng",
    "parthenos sylvia": "Bướm cánh bạc sao",
    "cethosia biblis": "Bướm đăng ten đỏ",
    "cethosia cyane": "Bướm đăng ten đốm trắng",
    "vindula erota": "Bướm cánh du thuyền",
    "phalanta phalantha": "Bướm báo đốm thường",
    "junonia almana": "Bướm hoa cỏ mắt công",
    "junonia atlites": "Bướm hoa cỏ xám",
    "junonia lemonias": "Bướm hoa cỏ nâu mắt to",
    "junonia orithya": "Bướm hoa cỏ lam ngọc",
    "vanessa cardui": "Bướm hồng di cư",
    "kaniska canace": "Bướm giáp viền xanh lam",
    "symbrenthia lilaea": "Bướm giáp hoa văn hề",
    "symbrenthia hypselis": "Bướm giáp hoa văn hề đốm vàng",
    "hypolimnas misippus": "Bướm giáp cánh trứng giả hổ",
    "hypolimnas bolina": "Bướm giáp hoa râm đốm lam",
    "danaus chrysippus": "Bướm hổ cánh cam",
    "danaus genutia": "Bướm hổ sọc cánh rộng",
    "tirumala limniace": "Bướm hổ gân xanh lớn",
    "parantica aglea": "Bướm gân xanh đốm kính",
    "euploea core": "Bướm quạ đốm trắng",
    "euploea mulciber": "Bướm quạ xanh lấp lánh",
    "idea leuconoe": "Bướm cánh giấy khổng lồ",
    "elymnias hypermnestra": "Bướm mắt cọ đốm xanh",
    "stichophthalma louisa": "Bướm nữ hoàng rừng Louisa",
    "delias pasithoe": "Bướm phấn hoa đỏ đen",
    "delias descombesi": "Bướm phấn hoa vệt đỏ",
    "catopsilia pomona": "Bướm phấn muồng chanh",
    "catopsilia pyranthe": "Bướm phấn muồng vằn mờ",
    "eurema hecabe": "Bướm cỏ vàng thường",
    "hebomoia glaucippe": "Bướm phấn đầu cam khổng lồ",
    "cepora nerissa": "Bướm phấn gân đen thường",
    "curetis thetis": "Bướm mặt trời cánh bạc",
    "heliophorus epicles": "Bướm sapphire ngọc tím",
    "lampides boeticus": "Bướm xanh đậu biếc",
    "jamides bochus": "Bướm xanh vân xám ngọc",
    "zizeeria maha": "Bướm xanh cỏ nhạt",
    "zizina otis": "Bướm xanh cỏ thường",
    "abisara echerius": "Bướm mào đuôi nĩa thường",
    "badamia exclamationis": "Bướm nhảy cánh nhọn nâu",
    "udaspes folus": "Bướm nhảy gừng chấm trắng",
    "erionota thrax": "Bướm nhảy chuối lá lớn",
    "stibochiona nicea": "Bướm giáp đen nhung viền lam",
    "amathusia phidippus": "Bướm mắt cọ lớn dừa",
    "faunis eumeus": "Bướm mắt cọ nâu đốm",
    "thaumantis diores": "Bướm rừng xanh chớp",
    "discophora timora": "Bướm mắt cọ lớn đốm vàng",
    "doleschallia bisaltide": "Bướm lá mùa thu",
    "tirumala septentrionis": "Bướm hổ xanh sẫm",
    "euploea diocletianus": "Bướm quạ vằn trắng",
    "polyura narcaea": "Bướm hoàng tử ngọc bích",
    "polyura arja": "Bướm hoàng tử hai đuôi",
    "polyura eudamippus": "Bướm hoàng tử đuôi nhọn lớn",
    "euthalia lubentina": "Bướm nữ thần đốm đỏ",
    "euthalia aconthea": "Bướm nữ thần đốm nâu",
    "lexias pardalis": "Bướm hiệp sĩ chấm lục",
    "bassarona teuta": "Bướm hiệp sĩ vạch trắng",
    "moduza procris": "Bướm tướng quân đỏ vạch trắng",
    "athyma ranga": "Bướm thủy thủ cánh đen",
    "athyma cama": "Bướm thủy thủ cánh cam",
    "athyma selenophora": "Bướm thủy thủ vạch trắng",
    "neptis nata": "Bướm ba vạch nhỏ",
    "phaedyma columella": "Bướm ba vạch đuôi ngắn",
    "pantoporia hordonia": "Bướm ba vạch cam",
    "cirrochroa tyche": "Bướm vàng mùa hè",
    "cupha erymanthis": "Bướm đồng mộc",
    "vagrans egista": "Bướm lang thang",
    "terinos clarissa": "Bướm viền hoàng gia",
    "argynnis hyperbius": "Bướm hoa cỏ đuôi én phương Đông",
    "chersonesia risa": "Bướm bản đồ vằn gợn",
    "cyrestis nivea": "Bướm bản đồ trắng thẳng",
    "pseudergolis wedah": "Bướm sọc nâu gợn",
    "dichorragia nesimachus": "Bướm sấm sét viền xanh",
    "apatura parisatis": "Bướm hoàng đế đen nhỏ",
    "rohana tonkiniana": "Bướm hoàng tử Bắc Bộ",
    "hestina persimilis": "Bướm tiên nữ cánh trắng vằn",
    "euripus nyctelius": "Bướm gái nhảy cánh đốm",
    "helcyra superba": "Bướm công chúa trắng",
    "calinaga buddha": "Bướm Phật cánh mờ",
    "libythea celtis": "Bướm mỏ chim",
    "abisara fylla": "Bướm hoa kim vạch vàng",
    "dodona durga": "Bướm đuôi kiếm nhỏ",
    "zemeros flegyas": "Bướm hoa kim đốm sao",
}

# -----------------------------------------------------------------------------
# 2. COMPILE BIRDS OF VIETNAM MASTER CHECKLIST
# -----------------------------------------------------------------------------
print("\n=== Compiling Birds of Vietnam Master Checklist ===")

# Load curated 50 birds for plate availability & field marks
curated_birds = {}
if os.path.exists("data/vietnam_50_birds_50_butterflies.json"):
    with open("data/vietnam_50_birds_50_butterflies.json") as f:
        cdata = json.load(f)
        for b in cdata.get("birds", []):
            curated_birds[b["sciName"].strip().lower()] = b

# Load iNat observations & photos
inat_birds = {}
if os.path.exists("data/checklists/bird-vn_checklist.json"):
    with open("data/checklists/bird-vn_checklist.json") as f:
        idata = json.load(f)
        for b in idata.get("species", []):
            inat_birds[b["sciName"].strip().lower()] = b

# Load Vietnamese dictionary
vi_bird_dict = {}
with open("data/cache_wiki/vi_danh_sach_chim_viet_nam.json") as f:
    text_vi = json.load(f)["parse"]["wikitext"]["*"]

for line in text_vi.splitlines():
    line_s = line.strip()
    if line_s.startswith("*") and "''" in line_s:
        if any(tag in line_s for tag in ["'''Hiếm gặp'''", "'''Đặc hữu'''", "'''Du nhập'''", "'''Không tồn tại'''", "'''Cực kỳ nguy cấp'''", "'''Nguy cấp'''", "'''Dễ thương tổn'''", "'''Sắp bị đe dọa'''"]):
            continue
        cleaned = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", line_s)
        m = re.search(r"^\*+\s*(.*?)\s*\'\'([A-Z][a-z]+(?:\s+[a-z]+)+)\'\'(.*)$", cleaned)
        if m:
            vi_name = m.group(1).strip()
            sci = m.group(2).strip()
            notes = m.group(3).strip()
            words = sci.split()
            binom = f"{words[0]} {words[1]}"
            if vi_name:
                vi_bird_dict[binom.lower()] = {"vi": vi_name, "notes": notes}
                vi_bird_dict[sci.lower()] = {"vi": vi_name, "notes": notes}

# Load English master list
with open("data/cache_wiki/en_birds_of_vietnam.json") as f:
    text_en = json.load(f)["parse"]["wikitext"]["*"]

birds_master = []
current_group = ""
current_fam_sci = "Anatidae"
current_order_sci = "Anseriformes"
seen_sci = set()

for line in text_en.splitlines():
    line_s = line.strip()
    if line_s.startswith("==") and not line_s.startswith("==="):
        current_group = line_s.strip("=").strip()
    
    # Check for Order and Family anywhere on line
    if "Order:" in line_s or "Family:" in line_s:
        m_order = re.search(r"Order:\s*\[\[(?:[^\|\]]+\|)?([A-Za-z]+)\]\]", line_s)
        if m_order:
            current_order_sci = m_order.group(1).strip()
        m_fam = re.search(r"Family:\s*\[\[(?:[^\|\]]+\|)?([A-Za-z]+)\]\]", line_s)
        if m_fam:
            current_fam_sci = m_fam.group(1).strip()
            
    elif line_s.startswith("*") and "''" in line_s:
        m = re.search(r"^\*\s*\[\[(?:[^\|\]]+\|)?([^\]]+)\]\],\s*\'\'([A-Z][a-z]+(?:\s+[a-z]+)+)\'\'(.*)$", line_s)
        if not m:
            m = re.search(r"^\*\s*([^,\[\']+),\s*\'\'\[\[(?:[^\|\]]+\|)?([A-Z][a-z]+(?:\s+[a-z]+)+)\]\]\'\'(.*)$", line_s)
        if m:
            en_name = m.group(1).strip()
            sci_name = m.group(2).strip()
            notes = m.group(3).strip()
            sci_lower = sci_name.lower()
            if sci_lower in seen_sci:
                continue
            seen_sci.add(sci_lower)

            genus = sci_name.split()[0]
            species_ep = sci_name.split()[1] if len(sci_name.split()) > 1 else ""

            # Determine Vietnamese Name
            vi_name = ""
            if sci_lower in BIRD_NAME_OVERRIDES:
                vi_name = BIRD_NAME_OVERRIDES[sci_lower]
            elif sci_lower in curated_birds:
                vi_name = curated_birds[sci_lower].get("commonNameVi", "")
            elif sci_lower in vi_bird_dict:
                vi_name = vi_bird_dict[sci_lower]["vi"]
            else:
                prefix = BIRD_GENUS_PREFIX.get(genus, "")
                if prefix:
                    vi_name = f"{prefix} ({en_name})"
                else:
                    vi_name = en_name

            # Status in Vietnam
            status = "Bản địa (Native)"
            if "(A)" in notes or "accidental" in notes.lower():
                status = "Hiếm gặp / Lang thang (Accidental)"
            elif "(E)" in notes or "endemic" in notes.lower():
                status = "Đặc hữu Việt Nam (Endemic)"
            elif "(I)" in notes or "introduced" in notes.lower():
                status = "Du nhập (Introduced)"

            # Red list status
            iucn = "LC"
            if "critically endangered" in notes.lower() or "CR" in notes:
                iucn = "CR"
            elif "endangered" in notes.lower() or "EN" in notes:
                iucn = "EN"
            elif "vulnerable" in notes.lower() or "VU" in notes:
                iucn = "VU"
            elif "near-threatened" in notes.lower() or "near threatened" in notes.lower() or "NT" in notes:
                iucn = "NT"

            # Family info
            fam_meta = BIRD_FAMILY_MAP.get(current_fam_sci, {})
            family_vi = fam_meta.get("vi", f"Họ {current_fam_sci}")
            order = fam_meta.get("order", current_order_sci or "Passeriformes")

            # Observation count from iNat/GBIF
            inat_info = inat_birds.get(sci_lower, {})
            obs_count = inat_info.get("inatObservations", 0)
            gbif_count = inat_info.get("gbifOccurrences", 0)
            photos = inat_info.get("photos", [])

            # Check if curated plate ready
            curated_info = curated_birds.get(sci_lower, {})
            has_plate = curated_info.get("plateReady", False)
            plate_url = curated_info.get("plateUrl", "") if has_plate else ""
            field_marks = curated_info.get("fieldMarks", "")

            birds_master.append({
                "index": len(birds_master) + 1,
                "sciName": sci_name,
                "commonNameVi": vi_name,
                "commonNameEn": en_name,
                "family": current_fam_sci,
                "familyVi": family_vi,
                "order": order,
                "genus": genus,
                "species": species_ep,
                "status": status,
                "iucnStatus": iucn,
                "observationsInat": obs_count,
                "occurrencesGbif": gbif_count,
                "hasMuseumPlate": has_plate,
                "museumPlateUrl": plate_url,
                "fieldMarks": field_marks,
                "hasReferencePhoto": len(photos) > 0,
                "referencePhotoUrl": photos[0]["url"] if photos else ""
            })

print(f"Compiled {len(birds_master)} bird species across {len(set(b['family'] for b in birds_master))} families.")

# -----------------------------------------------------------------------------
# 3. COMPILE BUTTERFLIES OF VIETNAM MASTER CHECKLIST
# -----------------------------------------------------------------------------
print("\n=== Compiling Butterflies of Vietnam Master Checklist ===")

# Load curated 50 butterflies
curated_bf = {}
if os.path.exists("data/vietnam_50_birds_50_butterflies.json"):
    with open("data/vietnam_50_birds_50_butterflies.json") as f:
        cdata = json.load(f)
        for b in cdata.get("butterflies", []):
            curated_bf[b["sciName"].strip().lower()] = b

# Load iNat butterfly records
inat_bf = {}
if os.path.exists("data/checklists/butterfly-vn_checklist.json"):
    with open("data/checklists/butterfly-vn_checklist.json") as f:
        idata = json.load(f)
        for b in idata.get("species", []):
            inat_bf[b["sciName"].strip().lower()] = b

# Load Indochina butterflies wiki text
with open("data/cache_wiki/en_butterflies_of_indochina.json") as f:
    text_bf = json.load(f)["parse"]["wikitext"]["*"]

bf_dict = {}
current_fam = ""
current_sub = ""
current_gen = ""

for line in text_bf.splitlines():
    line_s = line.strip()
    if line_s.startswith("== Family"):
        m = re.search(r"Family\s+(?:\[\[)?([A-Za-z]+)", line_s)
        if m: current_fam = m.group(1).strip()
    elif "'''subfamily'''" in line_s:
        m = re.search(r"\[\[([A-Za-z]+)\]\]", line_s)
        if m: current_sub = m.group(1).strip()
    elif "'''genus'''" in line_s:
        m = re.search(r"\'\'\[\[(?:[^\|\]]+\|)?([A-Za-z]+)\]\]\'\'", line_s)
        if m: current_gen = m.group(1).strip()
    elif line_s.startswith("::*"):
        m = re.search(r"::\*\'\'\[\[(?:[^\|\]]+\|)?([A-Z][a-z]+(?:\s+[a-z\-]+)+)\]\]\'\'(.*)$", line_s)
        if m:
            sci = m.group(1).strip()
            rest = m.group(2).strip()
            en = ""
            m_en = re.search(r"[–—-]\s*([a-zA-Z\s\(\)\'\-]+)$", rest)
            if m_en: en = m_en.group(1).strip()
            sci_lower = sci.lower()
            if sci_lower not in bf_dict:
                bf_dict[sci_lower] = {
                    "sciName": sci,
                    "commonNameEn": en,
                    "family": current_fam,
                    "subfamily": current_sub,
                    "genus": current_gen or sci.split()[0]
                }

# Combine Indochina wiki butterflies + verified iNaturalist Vietnam butterflies
combined_bf_keys = list(bf_dict.keys())
for k in inat_bf.keys():
    if k not in bf_dict:
        combined_bf_keys.append(k)

butterflies_master = []
for k in combined_bf_keys:
    wiki_info = bf_dict.get(k, {})
    inat_info = inat_bf.get(k, {})
    curated_info = curated_bf.get(k, {})

    sci_name = wiki_info.get("sciName") or inat_info.get("sciName") or curated_info.get("sciName")
    if not sci_name:
        continue
    
    parts = sci_name.split()
    genus = parts[0]
    species_ep = parts[1] if len(parts) > 1 else ""

    # Accurate Family assignment from genus mapping or wiki
    family = ""
    if genus in BF_GENUS_MAP:
        family = BF_GENUS_MAP[genus][1]
    else:
        family = wiki_info.get("family") or inat_info.get("family") or "Nymphalidae"
        if family == "Unknown":
            family = "Nymphalidae"
    
    fam_meta = BF_FAMILY_MAP.get(family, {"en": family, "vi": f"Họ {family}"})
    family_vi = fam_meta["vi"]

    # English Name
    en_name = curated_info.get("commonNameEn") or wiki_info.get("commonNameEn") or inat_info.get("commonNames", {}).get("en", "")
    if not en_name:
        en_name = f"{genus} {species_ep}"

    # Vietnamese Name
    vi_name = ""
    if k in BF_NAME_OVERRIDES:
        vi_name = BF_NAME_OVERRIDES[k]
    elif curated_info.get("commonNameVi"):
        vi_name = curated_info["commonNameVi"]
    else:
        prefix, _ = BF_GENUS_MAP.get(genus, ("Bướm", family))
        vi_name = f"{prefix} {species_ep.replace('_', ' ').capitalize()}"

    # Museum plate info
    has_plate = curated_info.get("plateReady", False)
    plate_url = curated_info.get("plateUrl", "") if has_plate else ""
    field_marks = curated_info.get("fieldMarks", "")

    # iNat observation & photo info
    obs_count = inat_info.get("inatObservations", 0)
    gbif_count = inat_info.get("gbifOccurrences", 0)
    photos = inat_info.get("photos", [])

    # Status
    status = "Bản địa (Native)"
    if sci_name in ["Teinopalpus aureus", "Troides helena", "Troides aeacus"]:
        status = "Bảo vệ nghiêm ngặt (Cites / Sách Đỏ)"

    butterflies_master.append({
        "index": len(butterflies_master) + 1,
        "sciName": sci_name,
        "commonNameVi": vi_name,
        "commonNameEn": en_name,
        "family": family,
        "familyVi": family_vi,
        "order": "Lepidoptera",
        "genus": genus,
        "species": species_ep,
        "status": status,
        "observationsInat": obs_count,
        "occurrencesGbif": gbif_count,
        "hasMuseumPlate": has_plate,
        "museumPlateUrl": plate_url,
        "fieldMarks": field_marks,
        "hasReferencePhoto": len(photos) > 0,
        "referencePhotoUrl": photos[0]["url"] if photos else ""
    })

# Sort by Family, Genus, Species
butterflies_master.sort(key=lambda x: (x["family"], x["sciName"]))
for i, b in enumerate(butterflies_master, start=1):
    b["index"] = i

print(f"Compiled {len(butterflies_master)} butterfly species across {len(set(b['family'] for b in butterflies_master))} families.")

# -----------------------------------------------------------------------------
# 4. WRITE JSON DATASETS
# -----------------------------------------------------------------------------
birds_file = os.path.join(OUT_DIR, "vietnam_birds_master_checklist.json")
with open(birds_file, "w", encoding="utf-8") as f:
    json.dump({
        "title": "Birds of Vietnam Master Checklist (Danh lục Chim Việt Nam)",
        "version": "1.0.0",
        "region": "VN",
        "authority": "IOC World Bird List / Craik & Minh 2018 / Vietnam Red Data Book",
        "totalSpecies": len(birds_master),
        "familiesCount": len(set(b["family"] for b in birds_master)),
        "ordersCount": len(set(b["order"] for b in birds_master)),
        "species": birds_master
    }, f, ensure_ascii=False, indent=2)

butterflies_file = os.path.join(OUT_DIR, "vietnam_butterflies_master_checklist.json")
with open(butterflies_file, "w", encoding="utf-8") as f:
    json.dump({
        "title": "Butterflies of Vietnam Master Checklist (Danh lục Bướm Việt Nam)",
        "version": "1.0.0",
        "region": "VN",
        "authority": "Monastyrskii & Devyatkin / iNaturalist Research / GBIF",
        "totalSpecies": len(butterflies_master),
        "familiesCount": len(set(b["family"] for b in butterflies_master)),
        "species": butterflies_master
    }, f, ensure_ascii=False, indent=2)

manifest_file = os.path.join(OUT_DIR, "vietnam_master_species_manifest.json")
with open(manifest_file, "w", encoding="utf-8") as f:
    json.dump({
        "dataset": "Spidex Vietnam Biodiversity Master Checklist",
        "generatedAt": "2026-09-13T21:40:00Z",
        "summary": {
            "birds": {
                "total": len(birds_master),
                "families": len(set(b["family"] for b in birds_master)),
                "orders": len(set(b["order"] for b in birds_master)),
                "withMuseumPlates": sum(1 for b in birds_master if b["hasMuseumPlate"]),
                "withReferencePhotos": sum(1 for b in birds_master if b["hasReferencePhoto"]),
                "endemic": sum(1 for b in birds_master if "Đặc hữu" in b["status"]),
                "familiesBreakdown": Counter(b["family"] for b in birds_master)
            },
            "butterflies": {
                "total": len(butterflies_master),
                "families": len(set(b["family"] for b in butterflies_master)),
                "withMuseumPlates": sum(1 for b in butterflies_master if b["hasMuseumPlate"]),
                "withReferencePhotos": sum(1 for b in butterflies_master if b["hasReferencePhoto"]),
                "familiesBreakdown": Counter(b["family"] for b in butterflies_master)
            }
        },
        "files": {
            "birdsJson": birds_file,
            "butterfliesJson": butterflies_file,
            "birdsMarkdown": os.path.join(DOCS_DIR, "vietnam_birds_checklist.md"),
            "butterfliesMarkdown": os.path.join(DOCS_DIR, "vietnam_butterflies_checklist.md")
        }
    }, f, ensure_ascii=False, indent=2)

# -----------------------------------------------------------------------------
# 5. GENERATE CLEAN SEARCHABLE MARKDOWN DOCUMENTATION
# -----------------------------------------------------------------------------
print("\n=== Generating Master Markdown Documentation ===")

# Birds Markdown
birds_md_file = os.path.join(DOCS_DIR, "vietnam_birds_checklist.md")
with open(birds_md_file, "w", encoding="utf-8") as f:
    f.write("# Danh lục Toàn diện Các Loài Chim Việt Nam (Birds of Vietnam Master Checklist)\n\n")
    f.write(f"**Tổng số loài**: **{len(birds_master)} loài** thuộc **{len(set(b['family'] for b in birds_master))} họ** và **{len(set(b['order'] for b in birds_master))} bộ**.\n\n")
    f.write("> **Nguồn thẩm định**: IOC World Bird List v14.1, Craik & Minh (*Birds of Vietnam*, 2018), Sách Đỏ Việt Nam (Vietnam Red Data Book), Viện Sinh thái & Tài nguyên Sinh vật (IEBR).\n\n")
    
    by_order = {}
    for b in birds_master:
        o = b["order"]
        fam = b["family"]
        if o not in by_order:
            by_order[o] = {}
        if fam not in by_order[o]:
            by_order[o][fam] = []
        by_order[o][fam].append(b)

    for order_name, fam_dict in by_order.items():
        f.write(f"## {order_name}\n\n")
        for fam_name, sp_list in fam_dict.items():
            fam_vi = sp_list[0]["familyVi"]
            f.write(f"### {fam_vi} ({fam_name}) — {len(sp_list)} loài\n\n")
            f.write("| STT | Tên tiếng Việt | Tên khoa học | Tên tiếng Anh | Tình trạng | Sách đỏ |\n")
            f.write("| :--- | :--- | :--- | :--- | :--- | :--- |\n")
            for sp in sp_list:
                status_badge = sp["status"]
                if "Đặc hữu" in sp["status"]:
                    status_badge = "⭐ **Đặc hữu**"
                plate_icon = " 🎨" if sp["hasMuseumPlate"] else ""
                f.write(f"| {sp['index']} | **{sp['commonNameVi']}**{plate_icon} | *{sp['sciName']}* | {sp['commonNameEn']} | {status_badge} | `{sp['iucnStatus']}` |\n")
            f.write("\n")

# Butterflies Markdown
bf_md_file = os.path.join(DOCS_DIR, "vietnam_butterflies_checklist.md")
with open(bf_md_file, "w", encoding="utf-8") as f:
    f.write("# Danh lục Toàn diện Các Loài Bướm Việt Nam (Butterflies of Vietnam Master Checklist)\n\n")
    f.write(f"**Tổng số loài**: **{len(butterflies_master)} loài** thuộc **6 họ Bướm ngày chính (Rhopalocera / Papilionoidea)**.\n\n")
    f.write("> **Nguồn thẩm định**: A. L. Monastyrskii & A. L. Devyatkin (*Butterflies of Vietnam: An Illustrated Checklist*), iNaturalist Research-grade Specimens, GBIF.\n\n")

    by_fam = {}
    for b in butterflies_master:
        fam = b["family"]
        if fam not in by_fam:
            by_fam[fam] = []
        by_fam[fam].append(b)

    for fam_name, sp_list in by_fam.items():
        fam_vi = sp_list[0]["familyVi"]
        f.write(f"## {fam_vi} ({fam_name}) — {len(sp_list)} loài\n\n")
        f.write("| STT | Tên tiếng Việt | Danh pháp khoa học | Tên tiếng Anh | Chi (Genus) | Mẫu vật |\n")
        f.write("| :--- | :--- | :--- | :--- | :--- | :--- |\n")
        for sp in sp_list:
            plate_badge = "🎨 Tiêu bản chuẩn" if sp["hasMuseumPlate"] else ("📷 Ảnh thực địa" if sp["hasReferencePhoto"] else "—")
            f.write(f"| {sp['index']} | **{sp['commonNameVi']}** | *{sp['sciName']}* | {sp['commonNameEn']} | *{sp['genus']}* | {plate_badge} |\n")
        f.write("\n")

print("All master checklists and documentation generated successfully!")
