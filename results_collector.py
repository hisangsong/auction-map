# -*- coding: utf-8 -*-
"""매각결과 수집기(관찰 기반).

법원경매 공개 API(공고중 조회)는 과거 낙찰가를 주지 않는다. 그래서 매일 저장하는
data.json 의 '어제 스냅샷 ↔ 오늘 스냅샷' 차이로 각 물건의 결과를 관측해 누적한다.

- 어제 있던 물건이 오늘 사라짐 + 매각기일이 지남  → '매각(낙찰) 추정'
  (그 시점 최저가율을 '낙찰 하한율'로 누적: 낙찰가 ≥ 최종 최저가)
- 어제 있던 물건이 오늘 사라짐 + 매각기일 안 지남 → '취하/변경 추정'
- 어제·오늘 모두 있는데 유찰횟수가 늘어남            → '유찰' 1건

결과는 sale_results.json 에 (시도|용도)별로 누적한다. 날이 갈수록 표본이 쌓인다.
정확한 낙찰가는 아니지만, 지역·용도별 매각률/유찰/낙찰 하한율의 실관측 통계를 준다.
"""

import json
import re
import datetime
from pathlib import Path


def _cls(용도):
    u = 용도 or ""
    if re.search(r"아파트", u):
        return "아파트"
    if re.search(r"다세대|단독|연립|빌라|다가구|오피스텔|주택|도시형", u):
        return "주택"
    if re.search(r"상가|근린|점포|사무|공장|창고|숙박|건물", u):
        return "상가"
    if re.search(r"토지|대지|임야|전|답|과수|잡종|농지|도로", u):
        return "토지"
    return "기타"


def _key(it):
    return it.get("고유번호") or (str(it.get("사건번호", "")) + "|" + (it.get("소재지") or ""))


def _passed(dstr, today):
    try:
        return datetime.date.fromisoformat(dstr) <= today
    except (ValueError, TypeError):
        return False


def update_results(old_items, new_items, out_path):
    """old(어제)·new(오늘) 물건 목록을 비교해 sale_results.json 을 갱신한다."""
    out_path = Path(out_path)
    today = datetime.date.today()
    tstr = today.isoformat()

    acc = {"firstDay": tstr, "updatedAt": tstr, "days": 0, "agg": {}}
    if out_path.exists():
        try:
            acc = json.load(open(out_path, encoding="utf-8"))
        except Exception:
            pass
    acc.setdefault("agg", {})
    acc.setdefault("firstDay", tstr)

    newmap = {_key(it): it for it in new_items}
    oldmap = {_key(it): it for it in old_items}
    newkeys = set(newmap.keys())

    def slot(it):
        b = (it.get("시도") or "기타") + "|" + _cls(it.get("용도"))
        return acc["agg"].setdefault(b, {"sold": 0, "withdrawn": 0, "yuchal": 0,
                                         "rateSum": 0.0, "rateN": 0})

    sold = withdrawn = yuchal = 0
    for k, oit in oldmap.items():
        a = slot(oit)
        if k not in newkeys:
            giil = oit.get("매각기일") or ""
            rate = oit.get("최저가율") or 0
            if giil and _passed(giil, today):
                a["sold"] += 1
                sold += 1
                if rate:
                    a["rateSum"] += rate
                    a["rateN"] += 1
            else:
                a["withdrawn"] += 1
                withdrawn += 1
        else:
            nit = newmap[k]
            if (nit.get("유찰") or 0) > (oit.get("유찰") or 0):
                a["yuchal"] += 1
                yuchal += 1

    acc["updatedAt"] = tstr
    acc["days"] = int(acc.get("days", 0)) + 1
    out_path.write_text(json.dumps(acc, ensure_ascii=False), encoding="utf-8")
    print(f"매각결과 수집: 매각추정 {sold} / 취하추정 {withdrawn} / 유찰 {yuchal} "
          f"(누적 {acc['days']}일) -> {out_path.name}", flush=True)
    return acc
