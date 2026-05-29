from datetime import date
from app import scheduler as S

def test_next_workday_pushes_weekend_to_monday():
    assert S.next_workday(date(2026, 6, 6)) == date(2026, 6, 8)   # Sat → Mon
    assert S.next_workday(date(2026, 6, 7)) == date(2026, 6, 8)   # Sun → Mon
    assert S.next_workday(date(2026, 6, 5)) == date(2026, 6, 5)   # Fri stays

def test_add_workdays_skips_weekend():
    assert S.add_workdays(date(2026, 6, 5), 1) == date(2026, 6, 8)   # Fri +1 → Mon
    assert S.add_workdays(date(2026, 6, 8), 5) == date(2026, 6, 15)  # Mon +5 → next Mon
    assert S.add_workdays(date(2026, 6, 8), 0) == date(2026, 6, 8)
