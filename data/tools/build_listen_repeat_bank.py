from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCENARIO_PATH = ROOT / "data" / "scenarios" / "listen_repeat.json"


BASE_SCENARIOS = [
    {
        "id": "campus-website-login",
        "title": "Logging in to the campus website",
        "context": "A student helper explains how to access a university website.",
        "level": "medium",
        "topic": "campus-technology",
        "sourceType": "curated",
        "sentences": [
            {"id": "campus-website-login-01", "order": 1, "text": "Open the school website first.", "audioUrl": ""},
            {"id": "campus-website-login-02", "order": 2, "text": "Click the student login button.", "audioUrl": ""},
            {"id": "campus-website-login-03", "order": 3, "text": "Use your student ID and password.", "audioUrl": ""},
            {"id": "campus-website-login-04", "order": 4, "text": "The system may ask you to verify your email.", "audioUrl": ""},
            {
                "id": "campus-website-login-05",
                "order": 5,
                "text": "After logging in, choose the course registration page.",
                "audioUrl": "",
            },
            {
                "id": "campus-website-login-06",
                "order": 6,
                "text": "If the page does not load, refresh your browser and try again.",
                "audioUrl": "",
            },
            {
                "id": "campus-website-login-07",
                "order": 7,
                "text": "Students who forget passwords should contact technical support before registration closes.",
                "audioUrl": "",
            },
        ],
    },
    {
        "id": "library-study-room",
        "title": "Reserving a library study room",
        "context": "A librarian explains how to reserve and use a group study room.",
        "level": "medium",
        "topic": "library-services",
        "sourceType": "curated",
        "sentences": [
            {"id": "library-study-room-01", "order": 1, "text": "Choose a room on the library map.", "audioUrl": ""},
            {"id": "library-study-room-02", "order": 2, "text": "Select the time your group needs.", "audioUrl": ""},
            {"id": "library-study-room-03", "order": 3, "text": "You can reserve the room for two hours.", "audioUrl": ""},
            {"id": "library-study-room-04", "order": 4, "text": "Bring your student card when you arrive.", "audioUrl": ""},
            {"id": "library-study-room-05", "order": 5, "text": "Please cancel your booking if your plans change.", "audioUrl": ""},
            {
                "id": "library-study-room-06",
                "order": 6,
                "text": "Rooms left empty for fifteen minutes may be given to others.",
                "audioUrl": "",
            },
            {
                "id": "library-study-room-07",
                "order": 7,
                "text": "Food is not allowed, but covered drinks are fine in study rooms.",
                "audioUrl": "",
            },
        ],
    },
    {
        "id": "office-hours-appointment",
        "title": "Booking professor office hours",
        "context": "A classmate explains how to book a meeting with a professor.",
        "level": "medium",
        "topic": "academic-advising",
        "sourceType": "curated",
        "sentences": [
            {"id": "office-hours-appointment-01", "order": 1, "text": "Check the office hours schedule online.", "audioUrl": ""},
            {"id": "office-hours-appointment-02", "order": 2, "text": "Pick a time slot before it fills up.", "audioUrl": ""},
            {"id": "office-hours-appointment-03", "order": 3, "text": "Write your question in the booking form.", "audioUrl": ""},
            {
                "id": "office-hours-appointment-04",
                "order": 4,
                "text": "Attach your draft so the professor can prepare.",
                "audioUrl": "",
            },
            {
                "id": "office-hours-appointment-05",
                "order": 5,
                "text": "Arrive five minutes early and wait outside politely.",
                "audioUrl": "",
            },
            {
                "id": "office-hours-appointment-06",
                "order": 6,
                "text": "If you cannot attend, cancel early so another student can take the slot.",
                "audioUrl": "",
            },
            {
                "id": "office-hours-appointment-07",
                "order": 7,
                "text": "Bring specific questions, because short meetings are easier when goals are clear.",
                "audioUrl": "",
            },
        ],
    },
    {
        "id": "group-project-meeting",
        "title": "Preparing a group project meeting",
        "context": "A team leader gives instructions before a project meeting.",
        "level": "medium",
        "topic": "student-organizations",
        "sourceType": "curated",
        "sentences": [
            {"id": "group-project-meeting-01", "order": 1, "text": "Review last week's tasks before the meeting.", "audioUrl": ""},
            {"id": "group-project-meeting-02", "order": 2, "text": "Upload your slides to the shared folder.", "audioUrl": ""},
            {
                "id": "group-project-meeting-03",
                "order": 3,
                "text": "Each member should report progress in one minute.",
                "audioUrl": "",
            },
            {
                "id": "group-project-meeting-04",
                "order": 4,
                "text": "Mention blockers early so we can solve them together.",
                "audioUrl": "",
            },
            {
                "id": "group-project-meeting-05",
                "order": 5,
                "text": "After discussion, assign one clear owner to every task.",
                "audioUrl": "",
            },
            {
                "id": "group-project-meeting-06",
                "order": 6,
                "text": "Record key decisions because memory is unreliable after long meetings.",
                "audioUrl": "",
            },
            {
                "id": "group-project-meeting-07",
                "order": 7,
                "text": "Send the summary tonight so everyone starts tomorrow with the same priorities.",
                "audioUrl": "",
            },
        ],
    },
    {
        "id": "bus-to-campus",
        "title": "Taking the bus to campus",
        "context": "A student explains how to commute by bus in the morning.",
        "level": "easy",
        "topic": "transportation",
        "sourceType": "curated",
        "sentences": [
            {"id": "bus-to-campus-01", "order": 1, "text": "Leave home ten minutes before the bus.", "audioUrl": ""},
            {"id": "bus-to-campus-02", "order": 2, "text": "The number twelve bus stops near campus.", "audioUrl": ""},
            {"id": "bus-to-campus-03", "order": 3, "text": "Use your student card for a cheaper fare.", "audioUrl": ""},
            {"id": "bus-to-campus-04", "order": 4, "text": "Check the app in case the bus is delayed.", "audioUrl": ""},
            {"id": "bus-to-campus-05", "order": 5, "text": "Get off at the library stop, not the stadium.", "audioUrl": ""},
            {
                "id": "bus-to-campus-06",
                "order": 6,
                "text": "In rain, buses are crowded, so leave home even earlier.",
                "audioUrl": "",
            },
            {
                "id": "bus-to-campus-07",
                "order": 7,
                "text": "If you miss one bus, the next usually arrives in fifteen minutes.",
                "audioUrl": "",
            },
        ],
    },
    {
        "id": "printing-assignment",
        "title": "Printing an assignment",
        "context": "A teaching assistant explains how to print and submit homework.",
        "level": "medium",
        "topic": "coursework",
        "sourceType": "curated",
        "sentences": [
            {"id": "printing-assignment-01", "order": 1, "text": "Save your file as a PDF first.", "audioUrl": ""},
            {"id": "printing-assignment-02", "order": 2, "text": "Use double sided mode to save paper.", "audioUrl": ""},
            {"id": "printing-assignment-03", "order": 3, "text": "Add your name and student number on top.", "audioUrl": ""},
            {
                "id": "printing-assignment-04",
                "order": 4,
                "text": "Check page order before pressing the print button.",
                "audioUrl": "",
            },
            {
                "id": "printing-assignment-05",
                "order": 5,
                "text": "If the printer jams, ask the lab staff for help.",
                "audioUrl": "",
            },
            {
                "id": "printing-assignment-06",
                "order": 6,
                "text": "Staple the pages neatly and keep one photo as backup.",
                "audioUrl": "",
            },
            {
                "id": "printing-assignment-07",
                "order": 7,
                "text": "Submit before noon, because late work may lose points automatically.",
                "audioUrl": "",
            },
        ],
    },
    {
        "id": "dorm-check-in",
        "title": "Checking in to a dorm",
        "context": "A resident assistant explains dorm check in steps for new students.",
        "level": "medium",
        "topic": "residence-life",
        "sourceType": "curated",
        "sentences": [
            {"id": "dorm-check-in-01", "order": 1, "text": "Bring your passport and admission letter.", "audioUrl": ""},
            {"id": "dorm-check-in-02", "order": 2, "text": "Sign the housing agreement at the front desk.", "audioUrl": ""},
            {"id": "dorm-check-in-03", "order": 3, "text": "Collect your room key and laundry card.", "audioUrl": ""},
            {
                "id": "dorm-check-in-04",
                "order": 4,
                "text": "Check furniture carefully and report any damage today.",
                "audioUrl": "",
            },
            {
                "id": "dorm-check-in-05",
                "order": 5,
                "text": "Do not leave personal items in hallway common areas.",
                "audioUrl": "",
            },
            {
                "id": "dorm-check-in-06",
                "order": 6,
                "text": "Quiet hours begin at ten, so use headphones at night.",
                "audioUrl": "",
            },
            {
                "id": "dorm-check-in-07",
                "order": 7,
                "text": "If your key is lost, contact the front desk immediately to avoid penalties.",
                "audioUrl": "",
            },
        ],
    },
    {
        "id": "campus-job-application",
        "title": "Applying for a campus job",
        "context": "A senior student shares steps for applying to campus jobs.",
        "level": "hard",
        "topic": "career-services",
        "sourceType": "curated",
        "sentences": [
            {
                "id": "campus-job-application-01",
                "order": 1,
                "text": "Search openings on the student employment portal.",
                "audioUrl": "",
            },
            {
                "id": "campus-job-application-02",
                "order": 2,
                "text": "Update your resume before submitting any application.",
                "audioUrl": "",
            },
            {
                "id": "campus-job-application-03",
                "order": 3,
                "text": "Write a short cover letter for each role.",
                "audioUrl": "",
            },
            {
                "id": "campus-job-application-04",
                "order": 4,
                "text": "Highlight class projects that match the job duties.",
                "audioUrl": "",
            },
            {
                "id": "campus-job-application-05",
                "order": 5,
                "text": "Prepare two references who can comment on your reliability.",
                "audioUrl": "",
            },
            {
                "id": "campus-job-application-06",
                "order": 6,
                "text": "During interviews, answer directly and give one specific example from experience.",
                "audioUrl": "",
            },
            {
                "id": "campus-job-application-07",
                "order": 7,
                "text": "After interviewing, send a thank you email because polite follow up can improve your chance.",
                "audioUrl": "",
            },
        ],
    },
]


DOMAIN_TASKS = [
    {
        "topic": "academic-advising",
        "label": "academic advising",
        "find_place": "academic advising desk",
        "reach_office": "degree audit office",
        "use_resource": "major planning kiosk",
        "reserve_slot": "advisor appointment",
        "book_service": "graduation check session",
        "submit_document": "course overload form",
        "request_access": "department seminar list",
        "report_issue": "incorrect prerequisite hold",
        "prepare_event": "registration strategy workshop",
        "complete_application": "peer mentor application",
        "handle_exception": "late add request",
        "coordinate_program": "probation recovery plan",
    },
    {
        "topic": "library-services",
        "label": "library services",
        "find_place": "circulation desk",
        "reach_office": "course reserves room",
        "use_resource": "self-checkout station",
        "reserve_slot": "group study room",
        "book_service": "laptop loan pickup",
        "submit_document": "interlibrary loan form",
        "request_access": "special collections portal",
        "report_issue": "jammed library printer",
        "prepare_event": "citation clinic",
        "complete_application": "archive access application",
        "handle_exception": "overdue fine appeal",
        "coordinate_program": "research skills bootcamp",
    },
    {
        "topic": "residence-life",
        "label": "residence life",
        "find_place": "hall service desk",
        "reach_office": "laundry room entrance",
        "use_resource": "package locker wall",
        "reserve_slot": "guest study lounge",
        "book_service": "moving cart checkout",
        "submit_document": "room change form",
        "request_access": "after-hours kitchen access",
        "report_issue": "broken shower heater",
        "prepare_event": "floor meeting",
        "complete_application": "resident assistant application",
        "handle_exception": "late housing check-in",
        "coordinate_program": "weekend quiet-hours rotation",
    },
    {
        "topic": "campus-technology",
        "label": "campus technology",
        "find_place": "technology help desk counter",
        "reach_office": "computer lab office",
        "use_resource": "wireless setup kiosk",
        "reserve_slot": "software training seat",
        "book_service": "equipment pickup window",
        "submit_document": "device loan agreement",
        "request_access": "lab access group",
        "report_issue": "failing classroom projector",
        "prepare_event": "cybersecurity seminar",
        "complete_application": "student developer fellowship application",
        "handle_exception": "two-factor reset exception",
        "coordinate_program": "semester lab maintenance plan",
    },
    {
        "topic": "student-health",
        "label": "student health services",
        "find_place": "nurse triage desk",
        "reach_office": "immunization office",
        "use_resource": "wellness resource shelf",
        "reserve_slot": "vaccination appointment",
        "book_service": "nutrition coaching session",
        "submit_document": "medical history update form",
        "request_access": "patient portal account",
        "report_issue": "incorrect insurance charge",
        "prepare_event": "stress management workshop",
        "complete_application": "peer health educator application",
        "handle_exception": "late cancellation appeal",
        "coordinate_program": "exam week wellness campaign",
    },
    {
        "topic": "career-services",
        "label": "career services",
        "find_place": "resume review desk",
        "reach_office": "interview suite office",
        "use_resource": "job board terminal",
        "reserve_slot": "mock interview slot",
        "book_service": "career coaching session",
        "submit_document": "internship approval form",
        "request_access": "employer networking portal",
        "report_issue": "missing career fair badge",
        "prepare_event": "salary negotiation workshop",
        "complete_application": "student ambassador application",
        "handle_exception": "late internship registration exception",
        "coordinate_program": "alumni mentoring calendar",
    },
    {
        "topic": "transportation",
        "label": "campus transportation",
        "find_place": "transit office window",
        "reach_office": "bike storage room",
        "use_resource": "route planning kiosk",
        "reserve_slot": "airport shuttle seat",
        "book_service": "parking permit consultation",
        "submit_document": "commuter subsidy form",
        "request_access": "evening shuttle pass",
        "report_issue": "broken bus card reader",
        "prepare_event": "winter travel briefing",
        "complete_application": "student driver application",
        "handle_exception": "missed shuttle reimbursement request",
        "coordinate_program": "carpool coordination roster",
    },
    {
        "topic": "student-finance",
        "label": "student finance",
        "find_place": "bursar service counter",
        "reach_office": "scholarship office",
        "use_resource": "payment plan guidebook shelf",
        "reserve_slot": "tuition payment appointment",
        "book_service": "financial aid review session",
        "submit_document": "expense reimbursement form",
        "request_access": "billing portal access",
        "report_issue": "incorrect late fee",
        "prepare_event": "budget planning seminar",
        "complete_application": "grant assistant application",
        "handle_exception": "emergency loan exception",
        "coordinate_program": "semester payment calendar",
    },
    {
        "topic": "recreation-center",
        "label": "the recreation center",
        "find_place": "front equipment desk",
        "reach_office": "pool access office",
        "use_resource": "fitness orientation kiosk",
        "reserve_slot": "court reservation",
        "book_service": "personal training session",
        "submit_document": "club sport waiver",
        "request_access": "early weight room access",
        "report_issue": "broken locker keypad",
        "prepare_event": "injury prevention workshop",
        "complete_application": "intramural referee application",
        "handle_exception": "membership freeze exception",
        "coordinate_program": "team practice rotation",
    },
    {
        "topic": "international-services",
        "label": "international student services",
        "find_place": "visa advising desk",
        "reach_office": "document pickup office",
        "use_resource": "arrival checklist kiosk",
        "reserve_slot": "orientation seat",
        "book_service": "travel signature session",
        "submit_document": "address update form",
        "request_access": "immigration portal access",
        "report_issue": "incorrect SEVIS note",
        "prepare_event": "work authorization workshop",
        "complete_application": "global buddy application",
        "handle_exception": "late document submission exception",
        "coordinate_program": "arrival support schedule",
    },
    {
        "topic": "research-support",
        "label": "research support",
        "find_place": "undergraduate research desk",
        "reach_office": "lab matching office",
        "use_resource": "proposal resource shelf",
        "reserve_slot": "faculty meeting slot",
        "book_service": "statistics consulting session",
        "submit_document": "research abstract form",
        "request_access": "shared data room access",
        "report_issue": "missing lab supply order",
        "prepare_event": "poster design workshop",
        "complete_application": "summer research grant application",
        "handle_exception": "protocol deadline exception",
        "coordinate_program": "participant scheduling grid",
    },
    {
        "topic": "student-organizations",
        "label": "student organizations",
        "find_place": "club resources desk",
        "reach_office": "event approval office",
        "use_resource": "leadership handbook shelf",
        "reserve_slot": "tabling reservation",
        "book_service": "treasurer training session",
        "submit_document": "funding request form",
        "request_access": "club storage room access",
        "report_issue": "broken event speaker",
        "prepare_event": "leadership transition workshop",
        "complete_application": "executive board application",
        "handle_exception": "late budget appeal",
        "coordinate_program": "orientation week club schedule",
    },
    {
        "topic": "community-engagement",
        "label": "community engagement",
        "find_place": "service center desk",
        "reach_office": "volunteer office",
        "use_resource": "project signup board",
        "reserve_slot": "volunteer shift",
        "book_service": "community tutoring session",
        "submit_document": "background check form",
        "request_access": "partner site portal access",
        "report_issue": "incorrect service hour record",
        "prepare_event": "civic leadership workshop",
        "complete_application": "site leader application",
        "handle_exception": "late service waiver request",
        "coordinate_program": "weekend outreach calendar",
    },
    {
        "topic": "campus-safety",
        "label": "campus safety",
        "find_place": "security information desk",
        "reach_office": "lost and found office",
        "use_resource": "safety guide kiosk",
        "reserve_slot": "night escort request",
        "book_service": "self-defense class session",
        "submit_document": "incident statement form",
        "request_access": "lab safety clearance",
        "report_issue": "malfunctioning door alarm",
        "prepare_event": "emergency drill briefing",
        "complete_application": "student marshal application",
        "handle_exception": "parking ticket review request",
        "coordinate_program": "residence evacuation roster",
    },
]


SUPPLEMENTAL_SCENARIOS = [
    {
        "topic": "dining-and-sustainability",
        "label": "dining and sustainability",
        "kind": "find_place",
        "noun": "reusable container station",
    },
    {
        "topic": "dining-and-sustainability",
        "label": "dining and sustainability",
        "kind": "use_resource",
        "noun": "meal swipe kiosk",
    },
    {
        "topic": "dining-and-sustainability",
        "label": "dining and sustainability",
        "kind": "complete_application",
        "noun": "sustainability ambassador application",
    },
    {
        "topic": "dining-and-sustainability",
        "label": "dining and sustainability",
        "kind": "coordinate_program",
        "noun": "zero waste event schedule",
    },
]


KIND_ORDER = [
    ("find_place", "easy"),
    ("reach_office", "easy"),
    ("use_resource", "easy"),
    ("reserve_slot", "medium"),
    ("book_service", "medium"),
    ("submit_document", "medium"),
    ("request_access", "medium"),
    ("report_issue", "medium"),
    ("prepare_event", "medium"),
    ("complete_application", "hard"),
    ("handle_exception", "hard"),
    ("coordinate_program", "hard"),
]


def with_article(noun: str) -> str:
    first = noun.strip().lower()[:1]
    return f"{'an' if first in {'a', 'e', 'i', 'o', 'u'} else 'a'} {noun}"


def title_for(kind: str, noun: str) -> str:
    mapping = {
        "find_place": f"Finding the {noun}",
        "reach_office": f"Reaching the {noun}",
        "use_resource": f"Using the {noun}",
        "reserve_slot": f"Reserving {with_article(noun)}",
        "book_service": f"Booking {with_article(noun)}",
        "submit_document": f"Submitting the {noun}",
        "request_access": f"Requesting access to the {noun}",
        "report_issue": f"Reporting a problem with the {noun}",
        "prepare_event": f"Preparing for the {noun}",
        "complete_application": f"Completing the {noun}",
        "handle_exception": f"Handling {with_article(noun)}",
        "coordinate_program": f"Coordinating the {noun}",
    }
    return mapping[kind]


def context_for(kind: str, noun: str, label: str) -> str:
    mapping = {
        "find_place": f"A student helper explains how to locate the {noun} in {label}.",
        "reach_office": f"A campus guide explains how to reach the {noun} without getting lost in {label}.",
        "use_resource": f"A staff member explains how students use the {noun} in {label}.",
        "reserve_slot": f"A staff member explains how to reserve the {noun} through {label}.",
        "book_service": f"An experienced student explains how to book the {noun} offered by {label}.",
        "submit_document": f"A staff member explains how to submit the {noun} correctly through {label}.",
        "request_access": f"A staff member explains how to request the {noun} connected to {label}.",
        "report_issue": f"A staff member explains how to report the {noun} problem and get help from {label}.",
        "prepare_event": f"A peer leader explains how to get ready for the {noun} hosted by {label}.",
        "complete_application": f"A student guide explains how to complete the {noun} tied to {label}.",
        "handle_exception": f"A staff member explains how students handle the {noun} within {label}.",
        "coordinate_program": f"A team leader explains how to organize the {noun} inside {label}.",
    }
    return mapping[kind]


def sentences_for(kind: str, noun: str) -> list[str]:
    templates = {
        "find_place": [
            f"Start at the main entrance before you look for the {noun}.",
            f"Use the campus map to match the building code for the {noun}.",
            f"Follow the posted signs until the arrow for the {noun} appears.",
            f"Ask the front desk where the {noun} is located if the hallway feels confusing.",
            f"Take the elevator or stairs that lead directly to the {noun}.",
            f"Check the room number outside the {noun} before you join the line.",
            f"Save the location of the {noun} on your phone so the next visit is easier.",
        ],
        "reach_office": [
            f"Leave a few minutes early if you need to reach the {noun} before it closes.",
            f"Check which building entrance is closest to the {noun} before you start walking.",
            f"Walk past the first lobby until the sign for the {noun} becomes visible.",
            f"Use the floor directory to confirm the quickest route to the {noun}.",
            f"Ask a staff member whether the {noun} has moved to a temporary room.",
            f"Wait outside the {noun} only after you confirm the office hours on the door.",
            f"Mark the {noun} on your personal map so you can find it again next time.",
        ],
        "use_resource": [
            f"Read the short instructions beside the {noun} before you press any buttons.",
            f"Sign in with your student account if the {noun} asks for verification.",
            f"Check whether the {noun} has a time limit before you begin using it.",
            f"Keep your materials ready so the {noun} can be used without delay.",
            f"Ask nearby staff for help if the {noun} responds in an unexpected way.",
            f"Log out or clean up the {noun} as soon as you finish your task.",
            f"Report any visible problem with the {noun} before you leave the area.",
        ],
        "reserve_slot": [
            f"Open the booking page for the {noun} before the busy hours begin.",
            f"Compare the available times for the {noun} with your own schedule.",
            f"Choose the time for the {noun} that leaves room for walking or setup.",
            f"Sign in with your student account to confirm the {noun}.",
            f"Save the confirmation message for the {noun} as soon as it arrives.",
            f"Cancel the {noun} quickly if your plans change at the last minute.",
            f"Arrive early enough that the {noun} is not released to someone else.",
        ],
        "book_service": [
            f"Check the service description before you book the {noun}.",
            f"Pick the format of the {noun} that matches your immediate need.",
            f"Prepare one clear question so the {noun} can stay focused.",
            f"Bring any document that the {noun} might require during the session.",
            f"Confirm the location of the {noun} after you receive the email reminder.",
            f"Write down next steps before the {noun} ends and the details fade.",
            f"Follow up soon if the {noun} leads to another required action.",
        ],
        "submit_document": [
            f"Download the instructions for the {noun} before you start writing anything.",
            f"Fill in every required field on the {noun} using your official student information.",
            f"Review the {noun} carefully so you do not miss a signature or date.",
            f"Attach any supporting file that the {noun} requires before submission.",
            f"Submit the {noun} before the deadline because late forms are harder to fix.",
            f"Save a copy of the {noun} in case the office requests clarification later.",
            f"Check your email after sending the {noun} to confirm that it was received.",
        ],
        "request_access": [
            f"Read the eligibility rules before you request the {noun}.",
            f"Use your campus email when you ask for the {noun} so staff can verify you faster.",
            f"Explain briefly why the {noun} is necessary for your course or project.",
            f"Complete any training that must happen before the {noun} can be approved.",
            f"Check the approval timeline for the {noun} instead of assuming it is immediate.",
            f"Keep the confirmation message once the {noun} has been granted.",
            f"Contact the office again if the {noun} still does not work on the next day.",
        ],
        "report_issue": [
            f"Describe the {noun} as soon as you notice that it is not working correctly.",
            f"Take one clear photo of the {noun} if visual proof can speed up the repair.",
            f"Write down when the {noun} failed so the support team can trace the problem.",
            f"Use the official report channel for the {noun} instead of relying on word of mouth.",
            f"Explain how the {noun} is affecting your schedule or assignment if the delay matters.",
            f"Check for an update on the {noun} rather than assuming the issue is already solved.",
            f"Keep any ticket number connected to the {noun} until the repair is complete.",
        ],
        "prepare_event": [
            f"Read the schedule for the {noun} before you decide what to bring.",
            f"Register early if the {noun} has limited seats or materials.",
            f"Prepare one question so the {noun} feels useful instead of passive.",
            f"Bring notes, documents, or samples if the {noun} invites personal feedback.",
            f"Arrive a little early because the {noun} may start exactly on time.",
            f"Write down action items during the {noun} while the advice is still fresh.",
            f"Review your notes after the {noun} so the best ideas do not disappear.",
        ],
        "complete_application": [
            f"Read the full criteria for the {noun} before you invest time in the form.",
            f"Collect every required file for the {noun} before the portal opens.",
            f"Draft your responses offline so the {noun} is easier to edit and review.",
            f"Ask someone to proofread the {noun} because small errors look careless.",
            f"Submit the {noun} early enough to handle technical problems without panic.",
            f"Save the confirmation page for the {noun} after the final upload finishes.",
            f"Track future emails about the {noun} because some steps may happen in stages.",
        ],
        "handle_exception": [
            f"Read the official policy before you request help with the {noun}.",
            f"Explain the reason for the {noun} clearly instead of writing a vague excuse.",
            f"Attach supporting proof if the {noun} depends on a documented circumstance.",
            f"Send the {noun} to the correct office so time is not lost in forwarding.",
            f"Ask politely about the review timeline for the {noun} after you submit it.",
            f"Check your email often because the {noun} may require one more response from you.",
            f"Keep a written record of the {noun} until the final decision is confirmed.",
        ],
        "coordinate_program": [
            f"List the moving parts of the {noun} before you assign any responsibilities.",
            f"Share one clear timeline for the {noun} so everyone sees the same deadlines.",
            f"Confirm who owns each task connected to the {noun} before the week begins.",
            f"Store files for the {noun} in one shared place instead of scattered messages.",
            f"Review risks around the {noun} early enough that backup plans still exist.",
            f"Send a short update on the {noun} after every major change or decision.",
            f"Close the {noun} with a summary so the next round starts from a stable record.",
        ],
    }
    return templates[kind]


def scenario_id(topic: str, kind: str) -> str:
    return f"{topic}-{kind.replace('_', '-')}"


def build_generated_scenarios() -> list[dict[str, object]]:
    scenarios: list[dict[str, object]] = []
    for domain in DOMAIN_TASKS:
        for kind, level in KIND_ORDER:
            noun = domain[kind]
            slug = scenario_id(domain["topic"], kind)
            sentences = [
                {"id": f"{slug}-{index + 1:02d}", "order": index + 1, "text": text, "audioUrl": ""}
                for index, text in enumerate(sentences_for(kind, noun))
            ]
            scenarios.append(
                {
                    "id": slug,
                    "title": title_for(kind, noun),
                    "context": context_for(kind, noun, domain["label"]),
                    "level": level,
                    "topic": domain["topic"],
                    "sourceType": "curated",
                    "sentences": sentences,
                }
            )

    for item in SUPPLEMENTAL_SCENARIOS:
        slug = scenario_id(item["topic"], item["kind"])
        sentences = [
            {"id": f"{slug}-{index + 1:02d}", "order": index + 1, "text": text, "audioUrl": ""}
            for index, text in enumerate(sentences_for(item["kind"], item["noun"]))
        ]
        scenarios.append(
            {
                "id": slug,
                "title": title_for(item["kind"], item["noun"]),
                "context": context_for(item["kind"], item["noun"], item["label"]),
                "level": next(level for current_kind, level in KIND_ORDER if current_kind == item["kind"]),
                "topic": item["topic"],
                "sourceType": "curated",
                "sentences": sentences,
            }
        )
    return scenarios


def build_bank() -> dict[str, object]:
    generated = build_generated_scenarios()
    scenarios = BASE_SCENARIOS + generated
    scenarios.sort(key=lambda item: (item["level"], item["topic"], item["id"]))
    return {"scenarios": scenarios}


def main() -> None:
    bank = build_bank()
    SCENARIO_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCENARIO_PATH.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(bank['scenarios'])} scenarios to {SCENARIO_PATH}")


if __name__ == "__main__":
    main()
