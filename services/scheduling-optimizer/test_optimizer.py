import unittest
from main import solve
class OptimizerTest(unittest.TestCase):
    def test_color_and_capacity(self):
        records = [{"type":"WO","id":str(n),"siteId":"HARAM","status":"APPR","project":"1611","building":"MATAF","scheduledStart":None,"scheduledFinish":None,"laborId":None,"description":"test","priority":1,"due":"2026-10-16T08:00:00+03:00","duration":None,"skill":"inspection","materialsReady":True,"color":color} for n,color in enumerate(["blue","green"])]
        c={"records":records,"labor":[{"id":"L-01","skills":["inspection"],"siteIds":["HARAM"],"shifts":[1],"unavailableDates":[]}],"rules":{"MATAF":{"minutes":15,"jobPlanPrecedence":True}},"shifts":[{"id":1,"startHour":8,"hours":8}],"holidays":[],"restrictedBuildings":[]}
        result=solve({"startDate":"2026-10-19","days":3,"startTime":"08:00","colorSeparation":True},c)
        self.assertEqual(len(result["items"]),2)
        self.assertNotEqual(result["items"][0]["start"][:10],result["items"][1]["start"][:10])
        self.assertTrue(all(x["minutes"]==15 for x in result["items"]))
if __name__ == "__main__": unittest.main()
